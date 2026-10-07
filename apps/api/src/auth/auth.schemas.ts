import { z } from 'zod';

export const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
// Upper bound caps Argon2 work per request (DoS).
export const password = z.string().min(12, 'Password must be at least 12 characters').max(128);

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
export const timezone = z
  .string()
  .max(64)
  .refine((tz) => tz === 'UTC' || TIMEZONES.has(tz), { message: 'Unknown timezone' });

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(1).max(120),
  email,
  password,
  timezone: timezone.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
