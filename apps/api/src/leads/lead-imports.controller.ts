import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { IMPORT_LIMITS, importMappingSchema } from '@leadora/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { LeadImportsService } from './lead-imports.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

const startSchema = z.object({ mapping: importMappingSchema, ownerUserId: z.uuid().nullable().optional() });
type StartBody = z.infer<typeof startSchema>;

@ApiTags('lead-imports')
@Controller('lead-imports')
export class LeadImportsController {
  constructor(private readonly imports: LeadImportsService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('lead.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1, fields: 5 } }))
  upload(@CurrentAuth() auth: AuthContext, @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined) {
    return this.imports.upload(auth, file);
  }

  @Get()
  @RequirePermission('lead.import')
  async list(@CurrentAuth() auth: AuthContext) {
    return { items: await this.imports.list(auth) };
  }

  @Get(':id')
  @RequirePermission('lead.import')
  get(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.imports.get(auth, id);
  }

  @Post(':id/start')
  @HttpCode(202)
  @RequirePermission('lead.import')
  start(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(startSchema)) body: StartBody) {
    return this.imports.start(auth, id, body.mapping, body.ownerUserId);
  }

  @Get(':id/errors.csv')
  @RequirePermission('lead.import')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('x-content-type-options', 'nosniff')
  async errors(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Res({ passthrough: true }) res: Response) {
    const report = await this.imports.errorReport(auth, id);
    res.attachment(report.fileName);
    return report.csv;
  }
}
