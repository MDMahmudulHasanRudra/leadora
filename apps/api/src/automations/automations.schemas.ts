import { actionSchema, CONDITION_FIELDS, CONDITION_OPS, TRIGGERS } from '@leadora/domain';
import { z } from 'zod';

const FIELDS = Object.keys(CONDITION_FIELDS) as [keyof typeof CONDITION_FIELDS, ...(keyof typeof CONDITION_FIELDS)[]];

export const conditionSchema = z.object({
  field: z.enum(FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.union([z.string().max(100), z.number()])).max(50), z.null()]).optional(),
});

export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
  trigger: z.enum(TRIGGERS),
  triggerConfig: z.object({ days: z.number().int().min(1).max(365).optional() }).default({}),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionSchema).min(1, 'Add at least one action').max(10),
  priority: z.number().int().min(0).max(1000).default(100),
  cooldownMinutes: z.number().int().min(0).max(43_200).default(0),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export const toggleSchema = z.object({ enabled: z.boolean() });
export const runsQuerySchema = z.object({
  ruleId: z.uuid().optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const testSchema = z.object({ leadId: z.uuid() });
