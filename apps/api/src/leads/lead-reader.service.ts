import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  activities,
  type DbHandle,
  leadSources,
  leads,
  leadTagLinks,
  leadTags,
  pipelineStages,
  type Transaction,
  users,
} from '@leadora/database';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { DB } from '../infra/tokens';

type Db = DbHandle['db'] | Transaction;

export const leadNotFound = () => new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });

@Injectable()
export class LeadReader {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Lead rows shaped for the API, tenant-scoped, with source, stage, owner and tags. */
  async find(organizationId: string, opts: { where?: SQL; orderBy?: SQL[]; limit?: number; db?: Db } = {}) {
    const db = opts.db ?? this.handle.db;
    const scope = eq(leads.organizationId, organizationId);
    const rows = await db
      .select({
        id: leads.id,
        fullName: leads.fullName,
        email: leads.email,
        phone: leads.phone,
        companyName: leads.companyName,
        jobTitle: leads.jobTitle,
        location: leads.location,
        country: leads.country,
        industry: leads.industry,
        budget: leads.budget,
        currency: leads.currency,
        notes: leads.notes,
        priority: leads.priority,
        score: leads.score,
        temperature: leads.temperature,
        pipelineId: leads.pipelineId,
        lastContactedAt: leads.lastContactedAt,
        nextFollowupAt: leads.nextFollowupAt,
        archivedAt: leads.archivedAt,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        sourceId: leadSources.id,
        sourceName: leadSources.name,
        sourceType: leadSources.type,
        stageId: pipelineStages.id,
        stageKey: pipelineStages.key,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        stageOutcome: pipelineStages.outcome,
        ownerId: users.id,
        ownerName: users.fullName,
      })
      .from(leads)
      .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .leftJoin(users, eq(users.id, leads.ownerUserId))
      .where(opts.where ? and(scope, opts.where) : scope)
      .orderBy(...(opts.orderBy ?? [desc(leads.createdAt), desc(leads.id)]))
      .limit(opts.limit ?? 1000);

    const tagRows = rows.length
      ? await db
          .select({ leadId: leadTagLinks.leadId, name: leadTags.name })
          .from(leadTagLinks)
          .innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId))
          .where(inArray(leadTagLinks.leadId, rows.map((r) => r.id)))
          .orderBy(asc(leadTags.name))
      : [];

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      companyName: r.companyName,
      jobTitle: r.jobTitle,
      location: r.location,
      country: r.country,
      industry: r.industry,
      budget: r.budget === null ? null : Number(r.budget),
      currency: r.currency,
      notes: r.notes,
      priority: r.priority,
      score: r.score,
      temperature: r.temperature,
      pipelineId: r.pipelineId,
      source: { id: r.sourceId, name: r.sourceName, type: r.sourceType },
      stage: { id: r.stageId, key: r.stageKey, name: r.stageName, color: r.stageColor, outcome: r.stageOutcome },
      owner: r.ownerId ? { id: r.ownerId, fullName: r.ownerName } : null,
      tags: tagRows.filter((t) => t.leadId === r.id).map((t) => t.name),
      lastContactedAt: r.lastContactedAt,
      nextFollowupAt: r.nextFollowupAt,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async get(organizationId: string, id: string, db?: Db) {
    const [lead] = await this.find(organizationId, { where: eq(leads.id, id), limit: 1, db });
    if (!lead) throw leadNotFound();
    return lead;
  }

  async activities(organizationId: string, leadId: string) {
    await this.get(organizationId, leadId);
    const rows = await this.handle.db
      .select({
        id: activities.id,
        type: activities.type,
        payload: activities.payload,
        createdAt: activities.createdAt,
        actorId: users.id,
        actorName: users.fullName,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorUserId))
      .where(and(eq(activities.organizationId, organizationId), eq(activities.leadId, leadId)))
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(200);
    return rows.map(({ actorId, actorName, ...a }) => ({ ...a, actor: actorId ? { id: actorId, fullName: actorName } : null }));
  }
}
