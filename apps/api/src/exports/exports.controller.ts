import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type ExportRequest, exportRequestSchema, ExportsService } from './exports.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('fields')
  @RequirePermission('lead.export')
  fields(@CurrentAuth() auth: AuthContext) {
    return this.exports.fields(auth);
  }

  @Post()
  @HttpCode(202)
  @RequirePermission('lead.export')
  request(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(exportRequestSchema)) body: ExportRequest, @ReqMeta() meta: RequestMeta) {
    return this.exports.request(auth, body, meta);
  }

  @Get()
  @RequirePermission('lead.export')
  list(@CurrentAuth() auth: AuthContext) {
    return this.exports.list(auth);
  }

  @Get(':id')
  @RequirePermission('lead.export')
  get(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.exports.get(auth, id);
  }

  @Get(':id/download')
  @RequirePermission('lead.export')
  async download(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Res() res: Response) {
    const file = await this.exports.download(auth, id);
    res
      .status(200)
      .set({
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.fileName}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      })
      .send(file.body);
  }
}
