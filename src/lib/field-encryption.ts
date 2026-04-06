import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getEnv } from '../config/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer | null {
  const b64 = getEnv().ENCRYPTION_KEY_BASE64;
  if (!b64) return null;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY_BASE64 must decode to 32 bytes');
  }
  return raw;
}

export function encryptField(plain: string): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptField(payloadB64: string | null | undefined): string | null {
  if (!payloadB64) return null;
  const key = getKey();
  if (!key) return null;
  const buf = Buffer.from(payloadB64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) return null;
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
