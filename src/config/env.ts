import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().default('quickpay'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  OTP_SESSION_COOKIE_NAME: z.string().default('qp_otp_session'),
  REFRESH_COOKIE_NAME: z.string().default('qp_refresh'),

  OTP_TTL_SECONDS: z.coerce.number().min(60).max(600).default(180),
  OTP_MAX_ATTEMPTS: z.coerce.number().min(1).max(20).default(5),
  OTP_DELIVERY_CHANNEL: z.enum(['sms', 'email']).default('sms'),
  OTP_HMAC_SECRET: z.string().min(32),

  OTP_EMAIL_FROM: z.string().optional(),
  OTP_EMAIL_SUBJECT: z.string().default('Your Quick Pay verification code'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_OTP_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  BCRYPT_ROUNDS: z.coerce.number().min(10).max(14).default(12),
  PASSWORD_PEPPER: z.string().optional().default(''),

  ENCRYPTION_KEY_BASE64: z.string().optional(),

  BEEM_SMS_URL: z.string().url().default('https://apisms.beem.africa/v1/send'),
  BEEM_USERNAME: z.string().optional(),
  BEEM_PASSWORD: z.string().optional(),
  BEEM_SENDER_ID: z.string().default('INFO'),
  BEEM_SMS_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(30),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}
