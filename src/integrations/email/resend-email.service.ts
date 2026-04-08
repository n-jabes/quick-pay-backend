import { Resend } from 'resend';
import { getEnv } from '../../config/env';
import { getLogger } from '../../lib/logger';

export interface SendOtpEmailResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface SendCredentialsEmailParams {
  toEmail: string;
  fullName: string;
  username: string;
  temporaryPassword: string;
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
  const expiryMinutes = Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60));
  const ttlText = `${expiryMinutes} minute${expiryMinutes === 1 ? '' : 's'}`;
  const text = `Your Quick Pay verification code is ${otp}. It expires in ${ttlText}.`;
  const html = `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e6edf5;">
      <div style="background:#0b4db8; color:white; padding:20px 24px;">
        <h2 style="margin:0; font-size:20px;">Quick Pay Verification</h2>
        <p style="margin:8px 0 0; font-size:13px; opacity:.95;">Secure one-time code for sign in</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px; color:#1f2937;">Use the verification code below to continue logging in:</p>
        <div style="margin:16px 0; display:inline-block; padding:12px 18px; border-radius:10px; background:#f8fafc; border:1px solid #dbe5f0;">
          <span style="font-size:28px; letter-spacing:6px; font-weight:700; color:#0f172a;">${otp}</span>
        </div>
        <p style="margin:0 0 8px; color:#334155;">This code expires in <strong>${ttlText}</strong>.</p>
        <p style="margin:0; color:#64748b; font-size:12px;">If you did not request this code, please ignore this email and secure your account.</p>
      </div>
    </div>
  </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: env.OTP_EMAIL_FROM,
      to: [toEmail],
      subject,
      text,
      html,
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

export async function sendCredentialsViaEmail(
  params: SendCredentialsEmailParams,
): Promise<SendOtpEmailResult> {
  const env = getEnv();
  const log = getLogger();

  if (!env.RESEND_API_KEY || !env.OTP_EMAIL_FROM) {
    log.error('Resend credentials missing');
    return { ok: false, status: 500, error: 'Email provider not configured' };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const subject = env.USER_CREDENTIALS_EMAIL_SUBJECT;
  const html = `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e6edf5;">
      <div style="background:#0b4db8; color:white; padding:20px 24px;">
        <h2 style="margin:0; font-size:20px;">Quick Pay Account Created</h2>
        <p style="margin:8px 0 0; font-size:13px; opacity:.95;">Your access details are ready.</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px; color:#1f2937;">Hello ${params.fullName},</p>
        <p style="margin:0 0 14px; color:#1f2937;">
          An account has been created for you in Quick Pay. Please use the temporary credentials below to sign in.
        </p>
        <div style="background:#f8fafc; border:1px solid #dbe5f0; border-radius:10px; padding:14px; margin:16px 0;">
          <p style="margin:0 0 8px; color:#334155;"><strong>Username:</strong> ${params.username}</p>
          <p style="margin:0; color:#334155;"><strong>Temporary Password:</strong> ${params.temporaryPassword}</p>
        </div>
        <p style="margin:0 0 8px; color:#dc2626;"><strong>Security Notice:</strong> Change your password immediately after first login.</p>
        <p style="margin:0; color:#64748b; font-size:12px;">
          If you were not expecting this email, contact your system administrator immediately.
        </p>
      </div>
    </div>
  </div>
  `;
  const text = `Hello ${params.fullName}, your Quick Pay account has been created.\nUsername: ${params.username}\nTemporary Password: ${params.temporaryPassword}\nPlease change your password immediately after first login.`;

  try {
    const { error } = await resend.emails.send({
      from: env.OTP_EMAIL_FROM,
      to: [params.toEmail],
      subject,
      text,
      html,
    });

    if (error) {
      log.warn({ error, toEmail: params.toEmail }, 'Resend credentials email API error');
      return { ok: false, status: 502, error: 'Resend request failed' };
    }

    return { ok: true, status: 200 };
  } catch (err) {
    log.error({ err }, 'Resend credentials email network error');
    return { ok: false, status: 0, error: 'Email send failed' };
  }
}
