import { PRIORITIES } from '@leadora/domain';
import { z } from 'zod';

export { type CreateLeadInput, createLeadSchema, type UpdateLeadInput, updateLeadSchema } from '@leadora/domain';

export const listLeadsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  owner: z.union([z.literal('me'), z.literal('unassigned'), z.uuid()]).optional(),
  stageId: z.uuid().optional(),
  sourceId: z.uuid().optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  priority: z.enum(PRIORITIES).optional(),
  temperature: z.enum(['COLD', 'WARM', 'HOT']).optional(),
  archived: z.enum(['true', 'false']).default('false'),
});
export type ListLeadsQuery = z.infer<typeof listLeadsSchema>;
