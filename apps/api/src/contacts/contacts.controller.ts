import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { companies, contacts, type DbHandle, leads } from '@leadora/database';
import { escapeLike } from '@leadora/domain';
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';
import { ConversionService } from './conversion.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const searchSchema = z.object({ q: z.string().trim().min(1).max(100).optional() });

// Contacts and companies use lead.* permissions: the spec defines no separate contact.* keys.
@ApiTags('contacts')
@Controller()
export class ContactsController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly conversion: ConversionService,
  ) {}

  @Post('leads/:id/convert')
  @HttpCode(201)
  @RequirePermission('lead.update')
  convert(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.conversion.convert(auth, id);
  }

  @Get('contacts')
  @RequirePermission('lead.view')
  async listContacts(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(searchSchema)) { q }: { q?: string }) {
    const filters: SQL[] = [eq(contacts.organizationId, auth.organizationId)];
    if (q) {
      const p = `%${escapeLike(q)}%`;
      filters.push(or(ilike(contacts.fullName, p), ilike(contacts.email, p), ilike(contacts.phone, p), ilike(companies.name, p))!);
    }
    const items = await this.handle.db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        companyId: contacts.companyId,
        companyName: companies.name,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(...filters))
      .orderBy(asc(contacts.fullName))
      .limit(200);
    return { items };
  }

  @Get('contacts/:id')
  @RequirePermission('lead.view')
  async getContact(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    const [contact] = await this.handle.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, auth.organizationId)));
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found' });
    const [company] = contact.companyId
      ? await this.handle.db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, contact.companyId))
      : [];
    const history = await this.handle.db
      .select({ id: leads.id, fullName: leads.fullName, convertedAt: leads.convertedAt, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.organizationId, auth.organizationId), eq(leads.contactId, id)));
    return { ...contact, company: company ?? null, leads: history };
  }

  @Get('companies')
  @RequirePermission('lead.view')
  async listCompanies(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(searchSchema)) { q }: { q?: string }) {
    const filters: SQL[] = [eq(companies.organizationId, auth.organizationId)];
    if (q) filters.push(ilike(companies.name, `%${escapeLike(q)}%`));
    const items = await this.handle.db
      .select({ id: companies.id, name: companies.name, industry: companies.industry, domain: companies.domain, createdAt: companies.createdAt })
      .from(companies)
      .where(and(...filters))
      .orderBy(asc(companies.name))
      .limit(200);
    return { items };
  }

  @Get('companies/:id')
  @RequirePermission('lead.view')
  async getCompany(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    const [company] = await this.handle.db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), eq(companies.organizationId, auth.organizationId)));
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found' });
    const people = await this.handle.db
      .select({ id: contacts.id, fullName: contacts.fullName, email: contacts.email, phone: contacts.phone, jobTitle: contacts.jobTitle })
      .from(contacts)
      .where(and(eq(contacts.organizationId, auth.organizationId), eq(contacts.companyId, id)))
      .orderBy(asc(contacts.fullName));
    return { ...company, contacts: people };
  }
}
