import { z } from 'zod';

// Empty string or null clears the field; omitted leaves it unchanged.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const leadFields = {
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)).optional(),
  // Validated against the organization's country during ingestion.
  phone: z.string().trim().max(40).optional(),
  companyName: optionalText(200),
  jobTitle: optionalText(120),
  location: optionalText(200),
  country: z.string().trim().toUpperCase().length(2).optional(),
  industry: optionalText(120),
  budget: z.number().nonnegative().max(1e12).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  notes: optionalText(5000),
  priority: z.enum(PRIORITIES).optional(),
  sourceId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};

export const createLeadSchema = z
  .object(leadFields)
  .refine((v) => v.email || v.phone, { message: 'Provide an email or a phone number', path: ['email'] });
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object(leadFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
