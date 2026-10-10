import { ConflictException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { activities, companies, contacts, type DbHandle, leads, pipelineStages, type Transaction } from '@leadora/database';
import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { leadVisibility } from '@leadora/domain';
import { leadNotFound } from '../leads/lead-reader.service';
import { DB } from '../infra/tokens';

export const normalizeCompanyName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Spec §9: Lead → find-or-create Company → find-or-merge Contact → mark Lead converted.
 * The lead is never deleted; it keeps pointers to what it became.
 */
@Injectable()
export class ConversionService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async convert(auth: AuthContext, leadId: string) {
    return this.handle.db.transaction(async (tx) => {
      const [lead] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.organizationId, auth.organizationId), leadVisibility(auth)))
        .for('update');
      if (!lead) throw leadNotFound();
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead first' });
      if (lead.contactId) throw new ConflictException({ code: 'LEAD_ALREADY_CONVERTED', message: 'This lead is already converted' });

      const company = lead.companyName ? await this.findOrCreateCompany(tx, auth.organizationId, lead.companyName) : null;
      const { contact, merged } = await this.findOrMergeContact(tx, auth.organizationId, lead, company?.id ?? null);

      const [won] = await tx
        .select({ id: pipelineStages.id, key: pipelineStages.key })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, lead.pipelineId), eq(pipelineStages.outcome, 'WON')))
        .orderBy(asc(pipelineStages.position))
        .limit(1);
      if (!won) throw new UnprocessableEntityException({ code: 'NO_WON_STAGE', message: 'The pipeline has no won stage' });

      const [from] = await tx.select({ key: pipelineStages.key }).from(pipelineStages).where(eq(pipelineStages.id, lead.stageId));
      await tx
        .update(leads)
        .set({ contactId: contact.id, companyId: company?.id ?? null, stageId: won.id, convertedAt: new Date(), lostAt: null })
        .where(eq(leads.id, leadId));
      await tx.insert(activities).values({
        organizationId: auth.organizationId,
        leadId,
        actorUserId: auth.userId,
        type: 'lead.converted',
        payload: { contactId: contact.id, companyId: company?.id ?? null, mergedContact: merged, from: from?.key, to: won.key },
      });
      return { contact, company, mergedContact: merged };
    });
  }

  private async findOrCreateCompany(tx: Transaction, organizationId: string, rawName: string) {
    const name = rawName.trim().replace(/\s+/g, ' ');
    const normalizedName = normalizeCompanyName(name);
    await tx
      .insert(companies)
      .values({ organizationId, name, normalizedName })
      .onConflictDoNothing({ target: [companies.organizationId, companies.normalizedName] });
    const [company] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.organizationId, organizationId), eq(companies.normalizedName, normalizedName)));
    return company!;
  }

  private async findOrMergeContact(tx: Transaction, organizationId: string, lead: typeof leads.$inferSelect, companyId: string | null) {
    const matchers: SQL[] = [];
    if (lead.email) matchers.push(eq(contacts.email, lead.email));
    if (lead.phone) matchers.push(eq(contacts.phone, lead.phone));
    if (matchers.length) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`contact:${organizationId}:${lead.email ?? lead.phone}`}))`);
      const [existing] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), or(...matchers)))
        .limit(1);
      if (existing) {
        // Merge: fill gaps, never overwrite what the contact already has.
        const [merged] = await tx
          .update(contacts)
          .set({
            email: existing.email ?? lead.email,
            phone: existing.phone ?? lead.phone,
            jobTitle: existing.jobTitle ?? lead.jobTitle,
            location: existing.location ?? lead.location,
            companyId: existing.companyId ?? companyId,
          })
          .where(eq(contacts.id, existing.id))
          .returning();
        return { contact: merged!, merged: true };
      }
    }
    const [created] = await tx
      .insert(contacts)
      .values({
        organizationId,
        companyId,
        ownerUserId: lead.ownerUserId,
        fullName: lead.fullName,
        email: lead.email,
        phone: lead.phone,
        jobTitle: lead.jobTitle,
        location: lead.location,
      })
      .returning();
    return { contact: created!, merged: false };
  }
}
