import {
  activities,
  leadSources,
  leads,
  leadTagLinks,
  leadTags,
  organizations,
  pipelineStages,
  pipelines,
  type Transaction,
  users,
} from '@leadora/database';
import { and, eq, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import { loadCustomFieldDefinitions, validateCustomFields, writeCustomFields } from '../custom-fields/values';
import { DomainError } from '../errors';
import { normalizeEmail, normalizePhone } from './normalize';
import type { CreateLeadInput } from './schemas';

export type IngestResult =
  | { status: 'CREATED'; leadId: string }
  | { status: 'DUPLICATE'; existingLeadId: string; matchedOn: 'email' | 'phone' };

export type IngestSourceType = 'MANUAL' | 'CSV' | 'WEBSITE' | 'API';

export interface IngestContext {
  organizationId: string;
  actorUserId: string | null;
  /** Used when the input has no sourceId. */
  sourceType: IngestSourceType;
}

const invalid = (code: string, message: string) => new DomainError('invalid', code, message);

/**
 * The single path every lead takes into the system (spec §12):
 * normalize → validate → deduplicate → insert → activity. Callers own the transaction.
 */
export async function ingestLead(tx: Transaction, ctx: IngestContext, input: CreateLeadInput): Promise<IngestResult> {
  const { organizationId } = ctx;
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone ? await normalizePhoneOrThrow(tx, organizationId, input.phone) : null;

  const customFields = validateCustomFields(
    await loadCustomFieldDefinitions(tx, organizationId, 'lead'),
    input.customFields ?? {},
    'create',
  );

  const duplicate = await findDuplicate(tx, organizationId, email, phone);
  if (duplicate) return { status: 'DUPLICATE', ...duplicate };

  const stage = await resolveStage(tx, organizationId, input.stageId);
  const sourceId = await resolveSource(tx, organizationId, input.sourceId, ctx.sourceType);
  const ownerUserId = input.ownerUserId === undefined ? ctx.actorUserId : await resolveOwner(tx, organizationId, input.ownerUserId);

  const [lead] = await tx
    .insert(leads)
    .values({
      organizationId,
      fullName: input.fullName,
      email,
      phone,
      companyName: input.companyName ?? null,
      jobTitle: input.jobTitle ?? null,
      location: input.location ?? null,
      country: input.country ?? null,
      industry: input.industry ?? null,
      budget: input.budget?.toString() ?? null,
      currency: input.currency ?? null,
      notes: input.notes ?? null,
      priority: input.priority ?? 'MEDIUM',
      sourceId,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      ownerUserId,
      createdByUserId: ctx.actorUserId,
    })
    .returning({ id: leads.id });

  if (input.tags?.length) await setLeadTags(tx, organizationId, lead!.id, input.tags);
  if (customFields.size) await writeCustomFields(tx, organizationId, lead!.id, customFields);

  await tx.insert(activities).values({
    organizationId,
    leadId: lead!.id,
    actorUserId: ctx.actorUserId,
    type: 'lead.created',
    payload: { sourceType: ctx.sourceType, stage: stage.key, ownerUserId },
  });
  return { status: 'CREATED', leadId: lead!.id };
}

export async function normalizePhoneOrThrow(tx: Transaction, organizationId: string, raw: string): Promise<string> {
  const [org] = await tx
    .select({ defaultCountry: organizations.defaultCountry })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const phone = normalizePhone(raw, org!.defaultCountry);
  if (!phone) {
    throw new DomainError('invalid', 'VALIDATION_FAILED', 'Validation failed', [{ path: 'phone', message: 'Not a valid phone number' }]);
  }
  return phone;
}

/** Archived leads still count: a duplicate is never silently re-created (spec §13). */
export async function findDuplicate(
  tx: Transaction,
  organizationId: string,
  email: string | null,
  phone: string | null,
  excludeLeadId?: string,
) {
  const matchers: SQL[] = [];
  // Serialize concurrent ingestion of the same contact (e.g. a retried webhook) so both can't pass the check.
  if (email) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead:${organizationId}:${email}`}))`);
    matchers.push(eq(leads.email, email));
  }
  if (phone) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead:${organizationId}:${phone}`}))`);
    matchers.push(eq(leads.phone, phone));
  }
  if (!matchers.length) return null;
  const [match] = await tx
    .select({ id: leads.id, email: leads.email })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), or(...matchers), excludeLeadId ? ne(leads.id, excludeLeadId) : undefined))
    .limit(1);
  if (!match) return null;
  return { existingLeadId: match.id, matchedOn: email && match.email === email ? ('email' as const) : ('phone' as const) };
}

/** A stage in the organization; with pipelineId, it must also belong to that pipeline. */
export async function resolveStage(tx: Transaction, organizationId: string, stageId?: string, pipelineId?: string) {
  const where = stageId
    ? and(
        eq(pipelineStages.id, stageId),
        eq(pipelineStages.organizationId, organizationId),
        pipelineId ? eq(pipelineStages.pipelineId, pipelineId) : undefined,
      )
    : and(eq(pipelineStages.organizationId, organizationId), eq(pipelines.isDefault, true));
  const [stage] = await tx
    .select({ id: pipelineStages.id, key: pipelineStages.key, pipelineId: pipelineStages.pipelineId, outcome: pipelineStages.outcome })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
    .where(where)
    .orderBy(pipelineStages.position)
    .limit(1);
  if (!stage) throw invalid('INVALID_STAGE', 'Stage not found');
  return stage;
}

export async function resolveSource(tx: Transaction, organizationId: string, sourceId: string | undefined, type: IngestSourceType) {
  const where = sourceId
    ? and(eq(leadSources.id, sourceId), eq(leadSources.organizationId, organizationId))
    : and(eq(leadSources.organizationId, organizationId), eq(leadSources.type, type));
  const [source] = await tx.select({ id: leadSources.id }).from(leadSources).where(where).limit(1);
  if (!source) throw invalid('INVALID_SOURCE', 'Lead source not found');
  return source.id;
}

export async function resolveOwner(tx: Transaction, organizationId: string, ownerUserId: string | null) {
  if (ownerUserId === null) return null;
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.organizationId, organizationId), eq(users.status, 'ACTIVE')));
  if (!owner) throw invalid('INVALID_OWNER', 'Owner must be an active user in your organization');
  return owner.id;
}

/** Replaces the lead's tags, creating missing tags. Names are case-insensitive; first spelling wins. */
export async function setLeadTags(tx: Transaction, organizationId: string, leadId: string, names: string[]) {
  const byKey = new Map<string, string>();
  for (const n of names) if (!byKey.has(n.trim().toLowerCase())) byKey.set(n.trim().toLowerCase(), n.trim());
  const unique = [...byKey.values()];
  await tx.delete(leadTagLinks).where(eq(leadTagLinks.leadId, leadId));
  if (!unique.length) return;
  await tx
    .insert(leadTags)
    .values(unique.map((name) => ({ organizationId, name })))
    .onConflictDoNothing();
  const tags = await tx
    .select({ id: leadTags.id })
    .from(leadTags)
    .where(and(eq(leadTags.organizationId, organizationId), inArray(leadTags.name, unique)));
  await tx.insert(leadTagLinks).values(tags.map((tag) => ({ leadId, tagId: tag.id })));
}
