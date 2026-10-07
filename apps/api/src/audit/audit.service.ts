import { Injectable } from '@nestjs/common';
import { auditLogs, type Transaction } from '@leadora/database';
import type { RequestMeta } from '../common/request-meta';

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  /** Must run inside the business transaction so the change and its audit row commit together. */
  async record(tx: Transaction, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
      ip: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
    });
  }
}
