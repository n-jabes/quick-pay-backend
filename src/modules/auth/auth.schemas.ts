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

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg =
      r.error.errors.map((e) => e.message).join('; ') || 'Invalid request body';
    throw createError(400, msg);
  }
  return r.data;
}
