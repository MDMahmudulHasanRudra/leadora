import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { DbHandle } from '@leadora/database';
import type { AuthContext } from '../auth/auth-context';
import { DB } from '../infra/tokens';
import { LeadIngestionService } from './lead-ingestion.service';
import { LeadReader } from './lead-reader.service';
import type { CreateLeadInput } from './leads.schemas';

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ingestion: LeadIngestionService,
    private readonly reader: LeadReader,
  ) {}

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
