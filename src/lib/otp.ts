import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { getEnv } from '../config/env';

export function generateNumericOtp(length = 6): string {
  const n = randomInt(0, 10 ** length);
  return n.toString().padStart(length, '0');
}

export function hashOtp(code: string): string {
  const secret = getEnv().OTP_HMAC_SECRET;
  return createHmac('sha256', secret).update(code).digest('hex');
}

export function verifyOtpHash(code: string, expectedHash: string): boolean {
  const h = hashOtp(code);
  try {
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
