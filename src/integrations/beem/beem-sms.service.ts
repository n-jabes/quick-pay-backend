import { getEnv } from '../../config/env';
import { getLogger } from '../../lib/logger';

export interface SendSmsResult {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

function normalizeRwandaMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('250') && digits.length >= 12) {
    return digits.slice(0, 12);
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `250${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `250${digits}`;
  }
  return digits;
}

export async function sendSmsViaBeem(toPhone: string, message: string): Promise<SendSmsResult> {
  const env = getEnv();
  const log = getLogger();

  if (env.BEEM_SMS_DISABLED) {
    log.info({ toPhone, message }, 'BEEM_SMS_DISABLED: OTP / SMS (dev)');
    return { ok: true, status: 200 };
  }

  const username = env.BEEM_USERNAME;
  const password = env.BEEM_PASSWORD;
  if (!username || !password) {
    log.error('Beem credentials missing');
    return { ok: false, status: 500, error: 'SMS provider not configured' };
  }

  const dest = normalizeRwandaMsisdn(toPhone);
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  const body = {
    source_addr: env.BEEM_SENDER_ID,
    encoding: 0,
    schedule_time: '',
    message,
    recipients: [{ recipient_id: '1', dest_addr: dest }],
  };

  try {
    const res = await fetch(env.BEEM_SMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      log.warn({ status: res.status, parsed }, 'Beem SMS HTTP error');
      return { ok: false, status: res.status, body: parsed, error: 'Beem request failed' };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    log.error({ err }, 'Beem SMS network error');
    return { ok: false, status: 0, error: 'SMS send failed' };
  }
}
