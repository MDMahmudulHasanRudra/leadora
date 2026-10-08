import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type DbHandle, leads, leadTagLinks, leadTags } from '@leadora/database';
import { and, eq, exists, ilike, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { decodeTimeCursor, encodeTimeCursor } from '../common/cursor';
import { DB } from '../infra/tokens';
import { LeadIngestionService } from './lead-ingestion.service';
import { LeadReader } from './lead-reader.service';
import type { CreateLeadInput, ListLeadsQuery } from './leads.schemas';
import { escapeLike } from './normalize';

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ingestion: LeadIngestionService,
    private readonly reader: LeadReader,
  ) {}

  async list(auth: AuthContext, q: ListLeadsQuery) {
    const filters: SQL[] = [q.archived === 'true' ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt)];
    if (q.owner === 'me') filters.push(eq(leads.ownerUserId, auth.userId));
    else if (q.owner === 'unassigned') filters.push(isNull(leads.ownerUserId));
    else if (q.owner) filters.push(eq(leads.ownerUserId, q.owner));
    if (q.stageId) filters.push(eq(leads.stageId, q.stageId));
    if (q.sourceId) filters.push(eq(leads.sourceId, q.sourceId));
    if (q.priority) filters.push(eq(leads.priority, q.priority));
    if (q.temperature) filters.push(eq(leads.temperature, q.temperature));
    if (q.tag) {
      filters.push(
        exists(
          this.handle.db
            .select({ one: sql`1` })
            .from(leadTagLinks)
            .innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId))
            .where(and(eq(leadTagLinks.leadId, leads.id), eq(leadTags.name, q.tag))),
        ),
      );
    }
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      filters.push(
        or(ilike(leads.fullName, pattern), ilike(leads.email, pattern), ilike(leads.phone, pattern), ilike(leads.companyName, pattern))!,
      );
    }
    if (q.cursor) {
      const c = decodeTimeCursor(q.cursor);
      filters.push(or(lt(leads.createdAt, c.createdAt), and(eq(leads.createdAt, c.createdAt), lt(leads.id, c.id)))!);
    }

    const rows = await this.reader.find(auth.organizationId, { where: and(...filters), limit: q.limit + 1 });
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > q.limit && last ? encodeTimeCursor(last.createdAt, last.id) : null };
  }

  async create(auth: AuthContext, input: CreateLeadInput) {
    if (input.ownerUserId !== undefined && input.ownerUserId !== auth.userId && !auth.permissions.has('lead.assign')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only create leads owned by yourself' });
    }
    return this.handle.db.transaction(async (tx) => {
      const result = await this.ingestion.ingest(
        tx,
        { organizationId: auth.organizationId, actorUserId: auth.userId, sourceType: 'MANUAL' },
        input,
      );
      if (result.status === 'DUPLICATE') {
        throw new ConflictException({
          code: 'LEAD_DUPLICATE',
          message: `A lead with this ${result.matchedOn} already exists`,
          details: { existingLeadId: result.existingLeadId, matchedOn: result.matchedOn },
        });
      }
      return this.reader.get(auth.organizationId, result.leadId, tx);
    });
  }
}
