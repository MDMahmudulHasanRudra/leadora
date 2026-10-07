import { z } from 'zod';

export const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
// Upper bound caps Argon2 work per request (DoS).
export const password = z.string().min(12, 'Password must be at least 12 characters').max(128);

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(1).max(120),
  email,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
