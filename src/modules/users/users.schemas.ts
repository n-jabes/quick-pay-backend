import createError from 'http-errors';
import { z } from 'zod';

export const userIdParamSchema = z.object({
  publicId: z.string().uuid(),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  gender: z.string().trim().min(1).max(30).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  role: z.enum(['admin', 'supervisor', 'agent']).optional(),
  agentCode: z.string().trim().min(2).max(40).nullable().optional(),
  nationalID: z.string().trim().min(2).max(120).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DEACTIVATED']),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().min(6).max(30),
  nationalID: z.string().trim().min(2).max(120),
  gender: z.string().trim().min(1).max(30).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  role: z.enum(['admin', 'supervisor', 'agent']),
  agentCode: z.string().trim().min(2).max(40).nullable().optional(),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message =
      result.error.errors.map((entry) => entry.message).join('; ') || 'Invalid request data';
    throw createError(400, message);
  }
  return result.data;
}

