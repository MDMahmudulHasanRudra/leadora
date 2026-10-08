import {
  Body,
  type CanActivate,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import type { Response } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../infra/tokens';
import { KnowledgeRagService } from './knowledge-rag.service';
import {
  askSchema,
  type CollectionInput,
  collectionSchema,
  listDocumentsSchema,
  searchSchema,
  settingsSchema,
  textSourceSchema,
  uploadFieldsSchema,
  urlSourceSchema,
} from './knowledge.schemas';
import { KnowledgeService, type UploadedFileLike } from './knowledge.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
// Read at startup (process.env is loaded by then). One byte over the cap reaches validation, which answers
// with a clear FILE_TOO_LARGE; anything bigger is cut off by multer with 413 before it fills memory.
const MAX_UPLOAD_BYTES = Number(process.env.KB_MAX_FILE_MB ?? 20) * 1_048_576 + 1;

/** ENABLE_KNOWLEDGE_BASE is the installation switch; org admins control the AI side in AI settings. */
@Injectable()
class KnowledgeEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}
  canActivate() {
    if (!this.env.ENABLE_KNOWLEDGE_BASE) throw new ConflictException({ code: 'KB_DISABLED', message: 'The knowledge base is turned off for this installation' });
    return true;
  }
}

@ApiTags('knowledge')
@Controller('kb')
@UseGuards(KnowledgeEnabledGuard)
export class KnowledgeController {
  constructor(
    private readonly kb: KnowledgeService,
    private readonly rag: KnowledgeRagService,
  ) {}

  @Get('collections')
  @RequirePermission('knowledge.view')
  collections(@CurrentAuth() auth: AuthContext) {
    return this.kb.listCollections(auth);
  }

  @Post('collections')
  @RequirePermission('knowledge.manage')
  createCollection(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(collectionSchema)) body: CollectionInput, @ReqMeta() meta: RequestMeta) {
    return this.kb.createCollection(auth, body, meta);
  }

  @Put('collections/:id')
  @RequirePermission('knowledge.manage')
  updateCollection(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(collectionSchema)) body: CollectionInput, @ReqMeta() meta: RequestMeta) {
    return this.kb.updateCollection(auth, id, body, meta);
  }

  @Delete('collections/:id')
  @HttpCode(204)
  @RequirePermission('knowledge.manage')
  async deleteCollection(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.kb.deleteCollection(auth, id, meta);
  }

  @Get('documents')
  @RequirePermission('knowledge.view')
  documents(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listDocumentsSchema)) q: z.infer<typeof listDocumentsSchema>) {
    return this.kb.listDocuments(auth, q.collectionId);
  }

  @Post('documents/upload')
  @RequirePermission('knowledge.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodPipe(uploadFieldsSchema)) body: z.infer<typeof uploadFieldsSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kb.upload(auth, meta, file, body);
  }

  @Post('documents/text')
  @RequirePermission('knowledge.manage')
  addText(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(textSourceSchema)) body: z.infer<typeof textSourceSchema>, @ReqMeta() meta: RequestMeta) {
    return this.kb.addText(auth, meta, body);
  }

  @Post('documents/url')
  @RequirePermission('knowledge.manage')
  addUrl(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(urlSourceSchema)) body: z.infer<typeof urlSourceSchema>, @ReqMeta() meta: RequestMeta) {
    return this.kb.addUrl(auth, meta, body);
  }

  @Get('documents/:id')
  @RequirePermission('knowledge.view')
  document(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.kb.getDocument(auth, id);
  }

  @Get('documents/:id/chunks')
  @RequirePermission('knowledge.view')
  chunks(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.kb.chunks(auth, id);
  }

  @Get('documents/:id/source')
  @RequirePermission('knowledge.view')
  async source(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Res() res: Response) {
    const file = await this.kb.source(auth, id);
    res
      .status(200)
      .set({
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      })
      .send(file.body);
  }

  @Post('documents/:id/reindex')
  @HttpCode(202)
  @RequirePermission('knowledge.manage')
  reindex(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.kb.reindex(auth, id);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermission('knowledge.manage')
  async deleteDocument(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.kb.deleteDocument(auth, id, meta);
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermission('knowledge.view', 'ai.use')
  search(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(searchSchema)) body: z.infer<typeof searchSchema>) {
    return this.rag.search(auth, body.query, body.collectionIds);
  }

  @Post('ask')
  @HttpCode(200)
  @RequirePermission('knowledge.view', 'ai.use')
  ask(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(askSchema)) body: z.infer<typeof askSchema>) {
    return this.rag.ask(auth, body.question, body.collectionIds);
  }

  @Get('settings')
  @RequirePermission('knowledge.manage')
  settings(@CurrentAuth() auth: AuthContext) {
    return this.kb.getSettings(auth);
  }

  @Put('settings')
  @RequirePermission('knowledge.manage')
  updateSettings(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.kb.updateSettings(auth, body);
  }
}
