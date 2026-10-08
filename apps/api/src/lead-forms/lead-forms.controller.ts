import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth, PublicCrossOrigin, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type FormInput, formSchema, formUpdateSchema, LeadFormsService } from './lead-forms.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('lead-forms')
@Controller('lead-forms')
export class LeadFormsController {
  constructor(private readonly forms: LeadFormsService) {}

  @Get()
  @RequirePermission('settings.manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.forms.list(auth);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(formSchema)) body: FormInput, @ReqMeta() meta: RequestMeta) {
    return this.forms.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(formUpdateSchema)) body: z.infer<typeof formUpdateSchema>, @ReqMeta() meta: RequestMeta) {
    return this.forms.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.forms.remove(auth, id, meta);
  }
}

/** Spec §91: what the embedded form on a customer's website talks to. */
@ApiTags('public')
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly forms: LeadFormsService) {}

  @Get(':key')
  @PublicCrossOrigin()
  config(@Param('key') key: string) {
    return this.forms.publicConfig(key);
  }

  @Post(':key/submissions')
  @HttpCode(200)
  @PublicCrossOrigin()
  submit(@Param('key') key: string, @Body() body: unknown, @Req() req: Request) {
    return this.forms.submit(key, body, { origin: req.get('origin') ?? null, ip: req.ip ?? null });
  }
}
