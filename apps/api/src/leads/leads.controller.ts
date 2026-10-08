import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { LeadReader } from './lead-reader.service';
import {
  type CreateLeadInput,
  createLeadSchema,
  type ListLeadsQuery,
  listLeadsSchema,
  type UpdateLeadInput,
  updateLeadSchema,
} from './leads.schemas';
import { LeadsService } from './leads.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly reader: LeadReader,
  ) {}

  @Get()
  @RequirePermission('lead.view')
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listLeadsSchema)) query: ListLeadsQuery) {
    return this.leads.list(auth, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('lead.create')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createLeadSchema)) body: CreateLeadInput) {
    return this.leads.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('lead.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.reader.get(auth.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('lead.update')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateLeadSchema)) body: UpdateLeadInput) {
    return this.leads.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('lead.delete')
  async archive(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    await this.leads.setArchived(auth, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('lead.delete')
  restore(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.leads.setArchived(auth, id, false);
  }

  @Get(':id/activities')
  @RequirePermission('lead.view')
  async activities(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return { items: await this.reader.activities(auth.organizationId, id) };
  }
}
