import { Body, ConflictException, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import { type DbHandle, inboxes } from '@leadora/database';
import { encryptSecret } from '@leadora/domain';
import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { isUniqueViolation } from '../common/db-errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, ENV } from '../infra/tokens';
import { ConversationsService, listSchema, messageSchema, startSchema, updateSchema } from './conversations.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const origin = z
  .string()
  .trim()
  .url()
  .transform((v) => new URL(v).origin);
const inboxSchema = z.discriminatedUnion('channel', [
  z.object({ name: z.string().trim().min(1).max(100), channel: z.literal('EMAIL'), address: z.string().trim().email().max(254) }),
  // Website chat: the widget key is generated; allowed origins guard the public endpoints.
  z.object({
    name: z.string().trim().min(1).max(100),
    channel: z.literal('WEB_CHAT'),
    config: z
      .object({
        allowedOrigins: z.array(origin).max(20).default([]),
        title: z.string().trim().max(80).default('Chat with us'),
        greeting: z.string().trim().max(300).default('Hi! How can we help?'),
      })
      .default({ allowedOrigins: [], title: 'Chat with us', greeting: 'Hi! How can we help?' }),
  }),
  // Meta channels: the WhatsApp phone-number id / Facebook page id / Instagram account id, plus the app secret
  // (verifies webhooks) and an access token (sends). Both are sealed at rest and never returned.
  ...(['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'] as const).map((channel) =>
    z.object({
      name: z.string().trim().min(1).max(100),
      channel: z.literal(channel),
      config: z.object({
        accountId: z.string().trim().regex(/^\d{5,30}$/, 'Use the numeric id from Meta'),
        appSecret: z.string().trim().min(16).max(200),
        accessToken: z.string().trim().min(20).max(1000),
      }),
    }),
  ),
]);
type InboxBody = z.infer<typeof inboxSchema>;
type StartBody = z.infer<typeof startSchema>;
type MessageBody = z.infer<typeof messageSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listSchema>;

@ApiTags('conversations')
@Controller()
export class ConversationsController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly conversations: ConversationsService,
  ) {}

  @Get('inboxes')
  @RequirePermission('conversation.view')
  async listInboxes(@CurrentAuth() auth: AuthContext) {
    const items = await this.handle.db
      .select({ id: inboxes.id, name: inboxes.name, channel: inboxes.channel, address: inboxes.address, enabled: inboxes.enabled })
      .from(inboxes)
      .where(eq(inboxes.organizationId, auth.organizationId))
      .orderBy(asc(inboxes.name));
    return { items };
  }

  /** The webhook secret is returned once; only its encrypted form is stored. */
  @Post('inboxes')
  @HttpCode(201)
  @RequirePermission('settings.manage')
  async createInbox(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(inboxSchema)) body: InboxBody) {
    const webhookSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    const widgetKey = body.channel === 'WEB_CHAT' ? `wc_${randomBytes(18).toString('base64url')}` : null;
    const verifyToken = randomBytes(24).toString('base64url');
    const seal = (v: string) => encryptSecret(v, this.env.DATA_ENCRYPTION_KEY);
    const meta = body.channel === 'WHATSAPP' || body.channel === 'FACEBOOK' || body.channel === 'INSTAGRAM' ? body.config : null;
    try {
      const [inbox] = await this.handle.db
        .insert(inboxes)
        .values({
          organizationId: auth.organizationId,
          name: body.name,
          channel: body.channel,
          address: body.channel === 'EMAIL' ? body.address : meta ? meta.accountId : widgetKey!,
          config:
            body.channel === 'WEB_CHAT'
              ? body.config
              : meta
                ? { accountId: meta.accountId, appSecretEnc: seal(meta.appSecret), accessTokenEnc: seal(meta.accessToken), verifyTokenEnc: seal(verifyToken) }
                : {},
          webhookSecretEnc: encryptSecret(webhookSecret, this.env.DATA_ENCRYPTION_KEY),
        })
        .returning({ id: inboxes.id, name: inboxes.name, channel: inboxes.channel, address: inboxes.address, enabled: inboxes.enabled });
      const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
      if (meta) {
        // Paste both into the Meta app's webhook settings; the verify token is shown only now.
        return { inbox, webhookUrl: `${base}/api/v1/webhooks/meta/${inbox!.id}`, verifyToken };
      }
      if (widgetKey) {
        return { inbox, widgetKey, embedCode: `<script src="${base}/chat-widget.js" data-widget-key="${widgetKey}" async></script>` };
      }
      return { inbox, webhookSecret, webhookUrl: `${base}/api/v1/webhooks/inbound/${inbox!.id}` };
    } catch (err) {
      if (isUniqueViolation(err, 'inboxes_org_name_unique')) {
        throw new ConflictException({ code: 'INBOX_EXISTS', message: 'An inbox with this name already exists' });
      }
      throw err;
    }
  }

  @Get('conversations')
  @RequirePermission('conversation.view')
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listSchema)) q: ListQuery) {
    return { items: await this.conversations.list(auth, q) };
  }

  @Post('conversations')
  @HttpCode(201)
  @RequirePermission('conversation.reply')
  start(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(startSchema)) body: StartBody) {
    return this.conversations.start(auth, body);
  }

  @Get('conversations/:id')
  @RequirePermission('conversation.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.conversations.get(auth.organizationId, id);
  }

  @Get('conversations/:id/messages')
  @RequirePermission('conversation.view')
  async messages(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return { items: await this.conversations.messages(auth, id) };
  }

  @Post('conversations/:id/messages')
  @HttpCode(201)
  @RequirePermission('conversation.reply')
  send(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(messageSchema)) body: MessageBody) {
    return this.conversations.send(auth, id, body);
  }

  @Patch('conversations/:id')
  @RequirePermission('conversation.reply')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateSchema)) body: UpdateBody) {
    return this.conversations.update(auth, id, body);
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  @RequirePermission('conversation.view')
  async read(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    await this.conversations.markRead(auth, id);
  }
}
