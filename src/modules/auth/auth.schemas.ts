import createError from 'http-errors';
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
});

export const resendOtpSchema = z.object({
  email: z.string().email(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(12, 'New password must be at least 12 characters')
    .regex(/[a-z]/, 'New password must include a lowercase letter')
    .regex(/[A-Z]/, 'New password must include an uppercase letter')
    .regex(/\d/, 'New password must include a number')
    .regex(/[^A-Za-z0-9]/, 'New password must include a special character')
    .regex(/^\S+$/, 'New password cannot contain spaces'),
});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg =
      r.error.errors.map((e) => e.message).join('; ') || 'Invalid request body';
    throw createError(400, msg);
  }
  return r.data;
}
