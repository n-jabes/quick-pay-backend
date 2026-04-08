import { Resend } from 'resend';
import { getEnv } from '../../config/env';
import { getLogger } from '../../lib/logger';

export interface SendOtpEmailResult {
  ok: boolean;
  status: number;
  error?: string;
}

export async function sendOtpViaEmail(toEmail: string, otp: string): Promise<SendOtpEmailResult> {
  const env = getEnv();
  const log = getLogger();

  if (env.EMAIL_OTP_DISABLED) {
    log.info({ toEmail, otp }, 'EMAIL_OTP_DISABLED: OTP email (dev)');
    return { ok: true, status: 200 };
  }

  if (!env.RESEND_API_KEY || !env.OTP_EMAIL_FROM) {
    log.error('Resend credentials missing');
    return { ok: false, status: 500, error: 'Email provider not configured' };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const subject = env.OTP_EMAIL_SUBJECT;
  const ttlText = `${env.OTP_TTL_SECONDS} seconds`;
  const text = `Your Quick Pay verification code is ${otp}. It expires in ${ttlText}.`;

  try {
    const { error } = await resend.emails.send({
      from: env.OTP_EMAIL_FROM,
      to: [toEmail],
      subject,
      text,
    });

    if (error) {
      log.warn({ error, toEmail }, 'Resend email API error');
      return { ok: false, status: 502, error: 'Resend request failed' };
    }

    return { ok: true, status: 200 };
  } catch (err) {
    log.error({ err }, 'Resend email network error');
    return { ok: false, status: 0, error: 'Email send failed' };
  }
}
