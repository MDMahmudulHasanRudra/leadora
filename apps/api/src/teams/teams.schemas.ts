import { z } from 'zod';

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(500).nullable();

export const createTeamSchema = z.object({ name, description: description.optional() });
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({ name, description })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
