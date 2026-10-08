import { Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { customFieldDefinitions, type DbHandle } from '@leadora/database';
import { and, eq, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { isUniqueViolation } from '../common/db-errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';

const TYPES = ['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'url', 'email', 'phone'] as const;
const SELECT_TYPES = new Set(['select', 'multi_select']);
const entity = z.enum(['lead', 'contact', 'company']).default('lead');
const options = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(100)
  .refine((o) => new Set(o).size === o.length, 'Options must be unique');

const createSchema = z
  .object({ entity, label: z.string().trim().min(1).max(80), type: z.enum(TYPES), options: options.optional(), required: z.boolean().default(false) })
  .refine((v) => !SELECT_TYPES.has(v.type) || v.options, { message: 'Select fields need options', path: ['options'] })
  .refine((v) => SELECT_TYPES.has(v.type) || !v.options, { message: 'Only select fields have options', path: ['options'] });
type CreateBody = z.infer<typeof createSchema>;

const updateSchema = z
  .object({ label: z.string().trim().min(1).max(80), options, required: z.boolean(), position: z.number().int().min(0).max(10_000) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
type UpdateBody = z.infer<typeof updateSchema>;

/** Stable machine key from the label: "Budget range" → budget_range. */
export function fieldKey(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return /^[a-z]/.test(key) ? key : `f_${key || 'field'}`;
}

const notFound = () => new NotFoundException({ code: 'CUSTOM_FIELD_NOT_FOUND', message: 'Custom field not found' });
const columns = {
  id: customFieldDefinitions.id,
  entity: customFieldDefinitions.entity,
  key: customFieldDefinitions.key,
  label: customFieldDefinitions.label,
  type: customFieldDefinitions.type,
  options: customFieldDefinitions.options,
  required: customFieldDefinitions.required,
  position: customFieldDefinitions.position,
};

@ApiTags('custom-fields')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private scope(auth: AuthContext, id: string) {
    return and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.organizationId, auth.organizationId), isNull(customFieldDefinitions.archivedAt));
  }

  @Get()
  @RequirePermission('lead.view')
  async list(@CurrentAuth() auth: AuthContext, @Query('entity') rawEntity?: string) {
    const items = await this.handle.db
      .select(columns)
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.organizationId, auth.organizationId),
          eq(customFieldDefinitions.entity, entity.parse(rawEntity)),
          isNull(customFieldDefinitions.archivedAt),
        ),
      )
      .orderBy(customFieldDefinitions.position, customFieldDefinitions.createdAt);
    return { items };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('settings.manage')
  async create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: CreateBody) {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [{ top } = { top: null }] = await tx
          .select({ top: max(customFieldDefinitions.position) })
          .from(customFieldDefinitions)
          .where(and(eq(customFieldDefinitions.organizationId, auth.organizationId), eq(customFieldDefinitions.entity, body.entity)));
        const [row] = await tx
          .insert(customFieldDefinitions)
          .values({
            organizationId: auth.organizationId,
            entity: body.entity,
            key: fieldKey(body.label),
            label: body.label,
            type: body.type,
            options: body.options ?? null,
            required: body.required,
            position: (top ?? -1) + 1,
          })
          .returning(columns);
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'custom_field_definitions_org_entity_key_unique')) {
        throw new ConflictException({ code: 'CUSTOM_FIELD_EXISTS', message: 'A field with this name already exists' });
      }
      throw err;
    }
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @Body(new ZodPipe(updateSchema)) body: UpdateBody) {
    const [current] = await this.handle.db.select().from(customFieldDefinitions).where(this.scope(auth, id));
    if (!current) throw notFound();
    if (body.options && !SELECT_TYPES.has(current.type)) {
      throw new ConflictException({ code: 'NOT_A_SELECT_FIELD', message: 'Only select fields have options' });
    }
    const [row] = await this.handle.db.update(customFieldDefinitions).set(body).where(this.scope(auth, id)).returning(columns);
    return row;
  }

  // Archive rather than delete: stored values stay for history and reporting.
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async archive(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    const updated = await this.handle.db
      .update(customFieldDefinitions)
      .set({ archivedAt: new Date() })
      .where(this.scope(auth, id))
      .returning({ id: customFieldDefinitions.id });
    if (!updated.length) throw notFound();
  }
}
