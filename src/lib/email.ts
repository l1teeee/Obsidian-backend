import * as React from 'react';
import { render } from '@react-email/render';
import { BrevoClient, BrevoEnvironment } from '@getbrevo/brevo';
import { env } from '../config/env';
import { LoginNotification }    from './emails/LoginNotification';
import { EmailVerification }    from './emails/EmailVerification';
import { PasswordReset }        from './emails/PasswordReset';
import { PostCreated }          from './emails/PostCreated';
import { PlatformConnected }    from './emails/PlatformConnected';

const brevo = new BrevoClient({
  apiKey:      env.BREVO_API_KEY,
  environment: BrevoEnvironment.Default,
});

async function send(to: string, subject: string, html: string): Promise<void> {
  await brevo.transactionalEmails.sendTransacEmail({
    sender:      { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
    to:          [{ email: to }],
    subject,
    htmlContent: html,
  });
}

export async function sendLoginNotification(toEmail: string, name?: string): Promise<void> {
  const now       = new Date();
  const loginDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' });
  const loginTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
  const changePasswordUrl = `${env.FRONTEND_URL}/forgot-password?email=${encodeURIComponent(toEmail)}`;

  const html = await render(
    React.createElement(LoginNotification, { email: toEmail, name, loginDate, loginTime, changePasswordUrl }),
  );
  try {
    await send(toEmail, 'New sign-in to your Vielink account', html);
  } catch (err) {
    console.error('[EMAIL] login notification error:', err);
  }
}

export async function sendVerificationEmail(toEmail: string, code: string): Promise<void> {
  const html = await render(
    React.createElement(EmailVerification, { email: toEmail, code }),
  );
  try {
    await send(toEmail, `${code} is your Vielink verification code`, html);
  } catch (err) {
    console.error('[EMAIL] verification email error:', err);
  }
}

export async function sendPasswordResetEmail(toEmail: string, code: string): Promise<void> {
  const html = await render(
    React.createElement(PasswordReset, { email: toEmail, code }),
  );
  try {
    await send(toEmail, `${code} is your Vielink password reset code`, html);
  } catch (err) {
    console.error('[EMAIL] password reset email error:', err);
  }
}

export async function sendPostCreatedEmail(
  toEmail: string,
  opts: { name?: string; platform: string; status: string; caption?: string; scheduledAt?: string },
): Promise<void> {
  const dashboardUrl = `${env.FRONTEND_URL}/posts`;
  const html = await render(
    React.createElement(PostCreated, { ...opts, dashboardUrl }),
  );
  try {
    const platformLabel = opts.platform.charAt(0).toUpperCase() + opts.platform.slice(1);
    await send(toEmail, `Your ${platformLabel} post has been ${opts.status}`, html);
  } catch (err) {
    console.error('[EMAIL] post created email error:', err);
  }
}

export async function sendPlatformConnectedEmail(
  toEmail: string,
  opts: { name?: string; platform: 'facebook' | 'instagram'; accountName: string },
): Promise<void> {
  const dashboardUrl = `${env.FRONTEND_URL}/platforms`;
  const html = await render(
    React.createElement(PlatformConnected, { ...opts, dashboardUrl }),
  );
  try {
    const platformLabel = opts.platform === 'facebook' ? 'Facebook' : 'Instagram';
    await send(toEmail, `${platformLabel} connected to your Vielink account`, html);
  } catch (err) {
    console.error('[EMAIL] platform connected email error:', err);
  }
}
