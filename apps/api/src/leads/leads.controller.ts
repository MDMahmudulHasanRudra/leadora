import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { LeadReader } from './lead-reader.service';
import { type CreateLeadInput, createLeadSchema } from './leads.schemas';
import { LeadsService } from './leads.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly reader: LeadReader,
  ) {}

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

  @Get(':id/activities')
  @RequirePermission('lead.view')
  async activities(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return { items: await this.reader.activities(auth.organizationId, id) };
  }
}
