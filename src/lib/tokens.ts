import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

export interface AccessPayload {
  sub: string;
  role: string;
}

export function signAccessToken(payload: AccessPayload): string {
  const env = getEnv();
  const options: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: 'solektra-quickpay',
    subject: payload.sub,
  };
  return jwt.sign({ role: payload.role }, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessPayload {
  const env = getEnv();
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'solektra-quickpay',
  }) as jwt.JwtPayload;
  if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') {
    throw new Error('INVALID_ACCESS_TOKEN');
  }
  return { sub: decoded.sub, role: decoded.role };
}

export function createRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function refreshTokenExpiresAt(): Date {
  const env = getEnv();
  const s = env.JWT_REFRESH_EXPIRES_IN.trim();
  const m = /^(\d+)([dhms])$/i.exec(s);
  if (!m) {
    return new Date(Date.now() + 7 * 86400000);
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms =
    unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : n * 1000;
  return new Date(Date.now() + ms);
}
