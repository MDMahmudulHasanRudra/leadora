import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { auditLogs, type DbHandle, users } from '@leadora/database';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { decodeSeqCursor, encodeSeqCursor } from '../common/cursor';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
  action: z.string().max(100).optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.uuid().optional(),
});
type Query = z.infer<typeof querySchema>;

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  @RequirePermission('audit.view')
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: Query) {
    const filters: SQL[] = [eq(auditLogs.organizationId, auth.organizationId)];
    if (q.action) filters.push(eq(auditLogs.action, q.action));
    if (q.resourceType) filters.push(eq(auditLogs.resourceType, q.resourceType));
    if (q.resourceId) filters.push(eq(auditLogs.resourceId, q.resourceId));
    if (q.cursor) filters.push(lt(auditLogs.seq, decodeSeqCursor(q.cursor)));

    const rows = await this.handle.db
      .select({
        id: auditLogs.id,
        seq: auditLogs.seq,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        oldValues: auditLogs.oldValues,
        newValues: auditLogs.newValues,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorId: users.id,
        actorName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(...filters))
      .orderBy(desc(auditLogs.seq))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ actorId, actorName, seq: _seq, ...e }) => ({
        ...e,
        actor: actorId ? { id: actorId, fullName: actorName } : null,
      })),
      nextCursor: rows.length > q.limit && last ? encodeSeqCursor(last.seq) : null,
    };
  }
}
