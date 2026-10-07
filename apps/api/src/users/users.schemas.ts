import { z } from 'zod';
import { email, password } from '../auth/auth.schemas';
import { ROLE_KEYS } from '../auth/permissions';

const role = z.enum(ROLE_KEYS as [string, ...string[]]);
const fullName = z.string().trim().min(1).max(120);

export const createUserSchema = z.object({ email, fullName, role, password });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ fullName, role, status: z.enum(['ACTIVE', 'DISABLED']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
