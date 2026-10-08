import { randomBytes } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { activities, type DbHandle, leadForms, type LeadFormFields } from '@leadora/database';
import { createLeadSchema, decryptSecret, encryptSecret, ingestLead } from '@leadora/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { RateLimiter } from '../common/rate-limiter';
import type { RequestMeta } from '../common/request-meta';
import { CAPTCHA_VERIFIER, DB, ENV } from '../infra/tokens';

export type CaptchaVerifier = (provider: 'TURNSTILE' | 'HCAPTCHA', secret: string, token: string, ip: string | null) => Promise<boolean>;

/** The providers' documented verification endpoints (fixed URLs, so no SSRF surface). */
export const defaultCaptchaVerifier: CaptchaVerifier = async (provider, secret, token, ip) => {
  const url = provider === 'TURNSTILE' ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : 'https://api.hcaptcha.com/siteverify';
  const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
  try {
    const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
};

const fieldSetting = z.enum(['required', 'optional', 'hidden']);
const origin = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v.replace(/\/$/, '');
    } catch {
      return false;
    }
  }, 'Use an origin like https://www.example.com')
  .transform((v) => v.replace(/\/$/, ''));

export const formSchema = z.object({
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().max(200).nullable().optional(),
  successMessage: z.string().trim().min(1).max(500).default('Thanks! We will be in touch soon.'),
  fields: z
    .object({ email: fieldSetting, phone: fieldSetting, companyName: z.enum(['optional', 'hidden']), message: z.enum(['optional', 'hidden']) })
    .refine((f) => f.email !== 'hidden' || f.phone !== 'hidden', 'Ask for at least an email or a phone number'),
  allowedOrigins: z.array(origin).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  captcha: z
    .object({ provider: z.enum(['NONE', 'TURNSTILE', 'HCAPTCHA']), siteKey: z.string().trim().max(200).optional(), secret: z.string().trim().max(500).optional() })
    .optional(),
});
export type FormInput = z.infer<typeof formSchema>;
export const formUpdateSchema = formSchema.partial().extend({ enabled: z.boolean().optional() });

const MAX_PER_VISITOR = 10; // per form, per 10 minutes
const MAX_PER_FORM = 500; // per hour

@Injectable()
export class LeadFormsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(CAPTCHA_VERIFIER) private readonly verifyCaptcha: CaptchaVerifier,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  private embed(publicKey: string) {
    const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    return `<div id="leadora-form"></div>\n<script src="${base}/lead-form.js" data-form-key="${publicKey}" data-target="leadora-form" async></script>`;
  }

  private shape(f: typeof leadForms.$inferSelect) {
    const { captchaSecretEnc, organizationId: _org, ...rest } = f;
    return { ...rest, hasCaptchaSecret: !!captchaSecretEnc, embedCode: this.embed(f.publicKey) };
  }

  private captchaValues(c: FormInput['captcha'], current?: typeof leadForms.$inferSelect) {
    if (!c) return {};
    if (c.provider === 'NONE') return { captchaProvider: 'NONE' as const, captchaSiteKey: null, captchaSecretEnc: null };
    const secretEnc = c.secret ? encryptSecret(c.secret, this.env.DATA_ENCRYPTION_KEY) : current?.captchaSecretEnc;
    if (!c.siteKey || !secretEnc) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'A CAPTCHA needs its site key and secret', details: [{ path: 'captcha', message: 'Site key and secret are required' }] });
    }
    return { captchaProvider: c.provider, captchaSiteKey: c.siteKey, captchaSecretEnc: secretEnc };
  }

  async list(auth: AuthContext) {
    const rows = await this.handle.db.select().from(leadForms).where(eq(leadForms.organizationId, auth.organizationId)).orderBy(desc(leadForms.createdAt));
    return { items: rows.map((r) => this.shape(r)) };
  }

  async create(auth: AuthContext, input: FormInput, meta: RequestMeta) {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(leadForms)
        .values({
          organizationId: auth.organizationId,
          name: input.name,
          title: input.title ?? null,
          successMessage: input.successMessage,
          fields: input.fields as LeadFormFields,
          allowedOrigins: input.allowedOrigins,
          tags: input.tags,
          publicKey: `lf_${randomBytes(18).toString('base64url')}`,
          createdByUserId: auth.userId,
          ...this.captchaValues(input.captcha),
        })
        .returning();
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead_form.created',
        resourceType: 'lead_form',
        resourceId: row!.id,
        newValues: { name: input.name, allowedOrigins: input.allowedOrigins },
        meta,
      });
      return this.shape(row!);
    });
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof formUpdateSchema>, meta: RequestMeta) {
    const [current] = await this.handle.db.select().from(leadForms).where(and(eq(leadForms.id, id), eq(leadForms.organizationId, auth.organizationId)));
    if (!current) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(leadForms)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.successMessage !== undefined ? { successMessage: input.successMessage } : {}),
          ...(input.fields ? { fields: input.fields as LeadFormFields } : {}),
          ...(input.allowedOrigins ? { allowedOrigins: input.allowedOrigins } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...this.captchaValues(input.captcha, current),
        })
        .where(eq(leadForms.id, id))
        .returning();
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'lead_form.updated', resourceType: 'lead_form', resourceId: id, newValues: { ...input, captcha: input.captcha ? { provider: input.captcha.provider } : undefined }, meta });
      return this.shape(row!);
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.handle.db.transaction(async (tx) => {
      const [row] = await tx.delete(leadForms).where(and(eq(leadForms.id, id), eq(leadForms.organizationId, auth.organizationId))).returning({ name: leadForms.name });
      if (!row) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'lead_form.deleted', resourceType: 'lead_form', resourceId: id, oldValues: { name: row.name }, meta });
    });
  }

  // ---- public ----

  private async publicForm(key: string) {
    const [form] = await this.handle.db.select().from(leadForms).where(and(eq(leadForms.publicKey, key), eq(leadForms.enabled, true)));
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'This form is not available' });
    return form;
  }

  /** Only what the embed needs to render — never the organization, secrets or tags. */
  async publicConfig(key: string) {
    const f = await this.publicForm(key);
    return { title: f.title, fields: f.fields, captcha: f.captchaProvider === 'NONE' ? null : { provider: f.captchaProvider, siteKey: f.captchaSiteKey } };
  }

  async submit(key: string, raw: unknown, ctx: { origin: string | null; ip: string | null }) {
    const form = await this.publicForm(key);
    if (form.allowedOrigins.length && (!ctx.origin || !form.allowedOrigins.includes(ctx.origin))) {
      throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'This form cannot be submitted from this website' });
    }
    await this.limiter.hit(`form:${form.id}:${ctx.ip ?? 'unknown'}`, MAX_PER_VISITOR, 600);
    await this.limiter.hit(`form:${form.id}`, MAX_PER_FORM, 3600);

    const f = form.fields;
    const contact = (setting: string, schema: z.ZodString) => (setting === 'required' ? schema : schema.optional().or(z.literal('').transform(() => undefined)));
    const parsed = z
      .object({
        fullName: z.string().trim().min(1).max(120),
        email: f.email === 'hidden' ? z.undefined().or(z.literal('')) : contact(f.email, z.string().trim().email().max(254)),
        phone: f.phone === 'hidden' ? z.undefined().or(z.literal('')) : contact(f.phone, z.string().trim().min(5).max(30)),
        companyName: z.string().trim().max(200).optional(),
        message: z.string().trim().max(5000).optional(),
        // Honeypot: hidden from people by the embed, filled in by naive bots.
        website: z.string().max(500).optional(),
        captchaToken: z.string().max(4000).optional(),
        pageUrl: z.string().trim().max(2000).optional(),
        utm: z.partialRecord(z.enum(['source', 'medium', 'campaign', 'term', 'content']), z.string().trim().max(200)).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Please check the form',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;
    const success = { ok: true as const, message: form.successMessage };
    if (body.website) return success;

    if (form.captchaProvider !== 'NONE') {
      const ok = body.captchaToken && form.captchaSecretEnc ? await this.verifyCaptcha(form.captchaProvider, decryptSecret(form.captchaSecretEnc, this.env.DATA_ENCRYPTION_KEY), body.captchaToken, ctx.ip) : false;
      if (!ok) throw new UnprocessableEntityException({ code: 'CAPTCHA_FAILED', message: 'Please complete the CAPTCHA and try again' });
    }

    await this.handle.db.transaction(async (tx) => {
      const result = await ingestLead(
        tx,
        {
          organizationId: form.organizationId,
          actorUserId: null,
          sourceType: 'WEBSITE',
          autoAssign: true,
          metadata: { formId: form.id, formName: form.name, pageUrl: body.pageUrl ?? null, utm: body.utm ?? null },
        },
        createLeadSchema.parse({
          fullName: body.fullName,
          email: body.email || undefined,
          phone: body.phone || undefined,
          companyName: body.companyName || undefined,
          notes: body.message || undefined,
          tags: form.tags,
        }),
      );
      // A repeat visitor: keep one lead (spec §13) and record what they sent on it.
      if (result.status === 'DUPLICATE') {
        await tx.insert(activities).values({
          organizationId: form.organizationId,
          leadId: result.existingLeadId,
          actorUserId: null,
          type: 'lead.form_submitted',
          payload: { formId: form.id, formName: form.name, message: body.message ?? null, pageUrl: body.pageUrl ?? null },
        });
      }
      await tx.update(leadForms).set({ submissionCount: sql`${leadForms.submissionCount} + 1`, lastSubmissionAt: new Date() }).where(eq(leadForms.id, form.id));
    });
    return success;
  }
}
