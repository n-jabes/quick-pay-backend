import * as bcrypt from 'bcrypt';
import createError from 'http-errors';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getEnv } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getRedis } from '../../lib/redis';
import { generateNumericOtp, hashOtp, verifyOtpHash } from '../../lib/otp';
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signAccessToken,
} from '../../lib/tokens';
import { sendSmsViaBeem } from '../../integrations/beem/beem-sms.service';
import { sendOtpViaEmail } from '../../integrations/email/resend-email.service';
import { writeAudit } from '../audit/audit.service';
import { toAuthUserResponse, roleToClient } from './user-mapper';

interface OtpSessionPayload {
  userId: string;
  email: string;
  otpHash: string;
  attempts: number;
}

function otpRedisKey(sessionId: string): string {
  const env = getEnv();
  return `${env.QUEUE_PREFIX}:otp:login:${sessionId}`;
}

function cookieBase() {
  const env = getEnv();
  return {
    httpOnly: true as const,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

function getClientMeta(req: Request) {
  const deviceId = (req.headers['x-device-id'] as string | undefined) ?? null;
  const deviceInfo = (req.headers['x-device-info'] as string | undefined) ?? null;
  const ip =
    (typeof req.ip === 'string' && req.ip) ||
    req.socket.remoteAddress ||
    null;
  const userAgent = req.get('user-agent') ?? null;
  return { deviceId, deviceInfo, ip, userAgent };
}

async function sendOtpForUser(user: { phone: string | null; email: string }, otp: string): Promise<boolean> {
  const env = getEnv();
  const message = `Your Quick Pay verification code is ${otp}. It expires in ${env.OTP_TTL_SECONDS} seconds.`;

  if (env.OTP_DELIVERY_CHANNEL === 'email') {
    const emailResult = await sendOtpViaEmail(user.email, otp);
    return emailResult.ok;
  }

  const phoneDigits = user.phone?.replace(/\D/g, '') ?? '';
  if (phoneDigits.length < 9) {
    return false;
  }

  const smsResult = await sendSmsViaBeem(user.phone as string, message);
  return smsResult.ok || Boolean(env.BEEM_SMS_DISABLED);
}

function dispatchOtpAsync(params: {
  user: { id: string; phone: string | null; email: string };
  otp: string;
  sessionKey: string;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  deviceInfo: string | null;
}): void {
  const { user, otp, sessionKey, ip, userAgent, deviceId, deviceInfo } = params;
  const maxAttempts = 3;
  const retryDelaysMs = [500, 1500, 3000];

  void (async () => {
    const redis = getRedis();
    let sent = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      sent = await sendOtpForUser({ phone: user.phone, email: user.email }, otp);
      if (sent) break;
      if (attempt < maxAttempts) {
        const delayMs = retryDelaysMs[attempt - 1] ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!sent) {
      await redis.del(sessionKey);
      await writeAudit({
        userId: user.id,
        action: 'AUTH_LOGIN_OTP_SEND_FAILED',
        resource: 'otp',
        status: 'FAILURE',
        ipAddress: ip,
        userAgent,
        metadata: { attempts: maxAttempts },
      });
      return;
    }

    await writeAudit({
      userId: user.id,
      action: 'AUTH_LOGIN_OTP_SENT',
      resource: 'otp',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      metadata: { deviceId, deviceInfoSnippet: deviceInfo?.slice(0, 500) },
    });
  })();
}

export async function login(req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const { email, password } = req.body as { email: string; password: string };
  const { deviceId, deviceInfo, ip, userAgent } = getClientMeta(req);
  const emailNorm = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: emailNorm },
    include: { role: true },
  });

  if (!user) {
    await writeAudit({
      action: 'AUTH_LOGIN',
      resource: 'password',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
      metadata: { email: emailNorm },
    });
    throw createError(401, 'Invalid credentials');
  }

  if (user.status !== 'ACTIVE') {
    await writeAudit({
      userId: user.id,
      action: 'AUTH_LOGIN',
      resource: 'status',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
    });
    throw createError(403, 'Account is not active');
  }

  const pepper = env.PASSWORD_PEPPER;
  const match = await bcrypt.compare(password + pepper, user.passwordHash);
  if (!match) {
    await writeAudit({
      userId: user.id,
      action: 'AUTH_LOGIN',
      resource: 'password',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
    });
    throw createError(401, 'Invalid credentials');
  }

  if (env.OTP_DELIVERY_CHANNEL === 'sms') {
    const phoneDigits = user.phone?.replace(/\D/g, '') ?? '';
    if (phoneDigits.length < 9) {
      throw createError(400, 'User phone is not configured for OTP delivery');
    }
  }

  if (env.OTP_DELIVERY_CHANNEL === 'email' && !user.email) {
    throw createError(400, 'User email is not configured for OTP delivery');
  }

  const otp = generateNumericOtp(6);
  const otpHash = hashOtp(otp);
  const sessionId = randomBytes(32).toString('hex');
  const payload: OtpSessionPayload = {
    userId: user.id,
    email: user.email,
    otpHash,
    attempts: 0,
  };

  const redis = getRedis();
  await redis.set(
    otpRedisKey(sessionId),
    JSON.stringify(payload),
    'EX',
    env.OTP_TTL_SECONDS,
  );

  const sessionKey = otpRedisKey(sessionId);
  dispatchOtpAsync({
    user: { id: user.id, phone: user.phone, email: user.email },
    otp,
    sessionKey,
    ip,
    userAgent,
    deviceId,
    deviceInfo,
  });

  res.cookie(env.OTP_SESSION_COOKIE_NAME, sessionId, {
    ...cookieBase(),
    maxAge: env.OTP_TTL_SECONDS * 1000,
  });

  await writeAudit({
    userId: user.id,
    action: 'AUTH_LOGIN_OTP_QUEUED',
    resource: 'otp',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: { deviceId, deviceInfoSnippet: deviceInfo?.slice(0, 500) },
  });

  res.status(200).json({
    message: 'OTP sent successfully',
  });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const { otp } = req.body as { otp: string };
  const { ip, userAgent, deviceId, deviceInfo } = getClientMeta(req);
  const sessionId = req.cookies?.[env.OTP_SESSION_COOKIE_NAME] as string | undefined;

  if (!sessionId) {
    await writeAudit({
      action: 'AUTH_VERIFY_OTP',
      resource: 'otp',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
      metadata: { reason: 'missing_session' },
    });
    throw createError(401, 'Login session expired. Please sign in again.');
  }

  const redis = getRedis();
  const key = otpRedisKey(sessionId);
  const raw = await redis.get(key);
  if (!raw) {
    res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());
    throw createError(401, 'Login session expired. Please sign in again.');
  }

  let state: OtpSessionPayload;
  try {
    state = JSON.parse(raw) as OtpSessionPayload;
  } catch {
    await redis.del(key);
    res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());
    throw createError(400, 'Invalid session');
  }

  if (state.attempts >= env.OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());
    await writeAudit({
      userId: state.userId,
      action: 'AUTH_VERIFY_OTP',
      resource: 'otp',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
      metadata: { reason: 'too_many_attempts' },
    });
    throw createError(429, 'Too many attempts. Please start over.');
  }

  if (!verifyOtpHash(otp, state.otpHash)) {
    state.attempts += 1;
    const ttl = await redis.ttl(key);
    if (ttl > 0) {
      await redis.set(key, JSON.stringify(state), 'EX', ttl);
    } else {
      await redis.set(key, JSON.stringify(state), 'EX', env.OTP_TTL_SECONDS);
    }
    await writeAudit({
      userId: state.userId,
      action: 'AUTH_VERIFY_OTP',
      resource: 'otp',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
    });
    throw createError(401, 'Invalid OTP');
  }

  await redis.del(key);
  res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());

  const user = await prisma.user.findUnique({
    where: { id: state.userId },
    include: { role: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw createError(401, 'Unauthorized');
  }

  const accessToken = signAccessToken({
    sub: user.publicId,
    role: roleToClient(user.role.code),
  });

  const { raw: refreshRaw, hash: refreshHash } = createRefreshToken();
  const expiresAt = refreshTokenExpiresAt();

  await prisma.refreshToken.create({
    data: {
      tokenHash: refreshHash,
      userId: user.id,
      expiresAt,
      deviceId,
      deviceInfo,
      ipAddress: ip ?? undefined,
    },
  });

  const refreshMaxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(env.REFRESH_COOKIE_NAME, refreshRaw, {
    ...cookieBase(),
    maxAge: refreshMaxAge,
  });

  await writeAudit({
    userId: user.id,
    action: 'AUTH_LOGIN_SUCCESS',
    resource: 'session',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
  });

  res.status(200).json({
    token: accessToken,
    data: toAuthUserResponse(user),
  });
}

export async function resendOtp(req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const { email } = req.body as { email: string };
  const { ip, userAgent, deviceId, deviceInfo } = getClientMeta(req);
  const sessionId = req.cookies?.[env.OTP_SESSION_COOKIE_NAME] as string | undefined;

  if (!sessionId) {
    throw createError(401, 'Login session expired. Please sign in again.');
  }

  const redis = getRedis();
  const key = otpRedisKey(sessionId);
  const raw = await redis.get(key);
  if (!raw) {
    res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());
    throw createError(401, 'Login session expired. Please sign in again.');
  }

  let state: OtpSessionPayload;
  try {
    state = JSON.parse(raw) as OtpSessionPayload;
  } catch {
    await redis.del(key);
    res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());
    throw createError(400, 'Invalid session');
  }

  if (state.email.toLowerCase() !== email.trim().toLowerCase()) {
    throw createError(400, 'Email does not match the current login attempt');
  }

  const user = await prisma.user.findUnique({
    where: { id: state.userId },
    include: { role: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw createError(401, 'Invalid session');
  }

  const otp = generateNumericOtp(6);
  const otpHash = hashOtp(otp);
  const next: OtpSessionPayload = {
    ...state,
    otpHash,
    attempts: 0,
  };

  await redis.set(key, JSON.stringify(next), 'EX', env.OTP_TTL_SECONDS);

  const sent = await sendOtpForUser({ phone: user.phone, email: user.email }, otp);
  if (!sent) {
    throw createError(502, 'Unable to send verification code. Try again later.');
  }

  res.cookie(env.OTP_SESSION_COOKIE_NAME, sessionId, {
    ...cookieBase(),
    maxAge: env.OTP_TTL_SECONDS * 1000,
  });

  await writeAudit({
    userId: user.id,
    action: 'AUTH_LOGIN_OTP_RESENT',
    resource: 'otp',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: { deviceId, deviceInfoSnippet: deviceInfo?.slice(0, 500) },
  });

  res.status(200).json({ message: 'OTP resent successfully' });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const { ip, userAgent } = getClientMeta(req);
  const rawCookie = req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawCookie) {
    throw createError(401, 'Unauthorized');
  }

  const hash = hashRefreshToken(rawCookie);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: { include: { role: true } } },
  });

  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    res.clearCookie(env.REFRESH_COOKIE_NAME, cookieBase());
    throw createError(401, 'Unauthorized');
  }

  const { raw: newRaw, hash: newHash } = createRefreshToken();
  const expiresAt = refreshTokenExpiresAt();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: newHash },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: newHash,
        userId: row.userId,
        expiresAt,
        ipAddress: ip ?? undefined,
        deviceInfo: userAgent ?? undefined,
      },
    }),
  ]);

  const accessToken = signAccessToken({
    sub: row.user.publicId,
    role: roleToClient(row.user.role.code),
  });

  const refreshMaxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(env.REFRESH_COOKIE_NAME, newRaw, {
    ...cookieBase(),
    maxAge: refreshMaxAge,
  });

  await writeAudit({
    userId: row.userId,
    action: 'AUTH_REFRESH',
    resource: 'session',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
  });

  res.status(200).json({ accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const { ip, userAgent } = getClientMeta(req);
  const rawCookie = req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined;

  if (rawCookie) {
    const hash = hashRefreshToken(rawCookie);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  res.clearCookie(env.REFRESH_COOKIE_NAME, cookieBase());
  res.clearCookie(env.OTP_SESSION_COOKIE_NAME, cookieBase());

  await writeAudit({
    action: 'AUTH_LOGOUT',
    resource: 'session',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
  });

  res.status(204).send();
}

export async function meAuthenticated(req: Request, res: Response): Promise<void> {
  const publicId = req.authUser?.publicId;
  if (!publicId) {
    throw createError(401, 'Unauthorized');
  }
  const user = await prisma.user.findUnique({
    where: { publicId },
    include: { role: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw createError(401, 'Unauthorized');
  }
  res.status(200).json({ data: toAuthUserResponse(user) });
}
