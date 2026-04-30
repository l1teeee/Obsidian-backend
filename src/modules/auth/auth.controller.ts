import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import * as authService from './auth.service';
import { env } from '../../config/env';

type VerifyEmailBody  = { email: string; code: string };
type ResendVerifyBody = { email: string };

// obs_rt  — httpOnly, holds the actual refresh token (never readable from JS)
const RT_NAME = 'obs_rt';
const RT_OPTS = {
  httpOnly: true,
  secure:   process.env['NODE_ENV'] === 'production',
  sameSite: 'lax' as const,
  path:     '/auth',
  maxAge:   7 * 24 * 60 * 60,   // 7 days in seconds
};

// obs_sid — NOT httpOnly, just a presence flag ("1") so the frontend knows
//           whether to attempt a silent refresh on page load.
//           Contains no sensitive data — the actual auth is still in obs_rt.
const SID_NAME = 'obs_sid';
const SID_OPTS = {
  httpOnly: false,
  secure:   process.env['NODE_ENV'] === 'production',
  sameSite: 'lax' as const,
  path:     '/',              // must be accessible on all frontend routes
  maxAge:   7 * 24 * 60 * 60,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

type RegisterBody        = { email: string; password: string };
type LoginBody           = { email: string; password: string; rememberMe?: boolean; force?: boolean };
type GoogleLoginBody     = { code: string };
type ForgotPasswordBody   = { email: string };
type VerifyResetOtpBody   = { email: string; otp: string };
type ResetPasswordBody    = { email: string; otp: string; password: string };

function setSessionCookies(reply: FastifyReply, refreshToken: string, persistent = true): void {
  const maxAge = persistent ? RT_OPTS.maxAge : undefined;
  reply.setCookie(RT_NAME,  refreshToken, { ...RT_OPTS,  maxAge });
  reply.setCookie(SID_NAME, '1',          { ...SID_OPTS, maxAge });
}

function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(RT_NAME,  { path: '/auth' });
  reply.clearCookie(SID_NAME, { path: '/', ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) });
}

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.register(
    request.body.email,
    request.body.password,
  );
  // No cookies set — user must verify email before logging in
  reply.code(201).send({ success: true, data: result });
}

export async function verifyEmailHandler(
  request: FastifyRequest<{ Body: VerifyEmailBody }>,
  reply: FastifyReply,
): Promise<void> {
  const tokens = await authService.verifyEmail(request.body.email, request.body.code);
  setSessionCookies(reply, tokens.refreshToken);
  reply.send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin, profileCompleted: tokens.profileCompleted },
  });
}

export async function resendVerificationHandler(
  request: FastifyRequest<{ Body: ResendVerifyBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.resendVerification(request.body.email);
  reply.send({ success: true, data: result });
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { email, password, rememberMe = true, force = false } = request.body;
  const deviceInfo = request.headers['user-agent']?.slice(0, 500);

  const result = await authService.login(email, password, deviceInfo, force);

  // Session conflict — return 409 with active session info so frontend can prompt
  if ('conflict' in result) {
    return reply.code(409).send({ success: false, error: { code: 'SESSION_LIMIT_EXCEEDED', ...result } });
  }

  setSessionCookies(reply, result.refreshToken, rememberMe);
  reply.send({
    success: true,
    data: { accessToken: result.accessToken, isFirstLogin: result.isFirstLogin, profileCompleted: result.profileCompleted },
  });
}

export async function googleLoginHandler(
  request: FastifyRequest<{ Body: GoogleLoginBody }>,
  reply: FastifyReply,
): Promise<void> {
  const deviceInfo = request.headers['user-agent']?.slice(0, 500);
  const tokens = await authService.loginWithGoogle(request.body.code, deviceInfo);
  setSessionCookies(reply, tokens.refreshToken);
  reply.send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin, profileCompleted: tokens.profileCompleted },
  });
}

export async function forgotPasswordHandler(
  request: FastifyRequest<{ Body: ForgotPasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.requestPasswordReset(request.body.email);
  reply.send({ success: true, data: result });
}

export async function verifyResetOtpHandler(
  request: FastifyRequest<{ Body: VerifyResetOtpBody }>,
  reply: FastifyReply,
): Promise<void> {
  await authService.verifyResetOtp(request.body.email, request.body.otp);
  reply.send({ success: true, data: null });
}

export async function resetPasswordHandler(
  request: FastifyRequest<{ Body: ResetPasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  await authService.resetPassword(request.body.email, request.body.otp, request.body.password);
  reply.send({ success: true, data: null });
}

export async function pingHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.send({ success: true, data: null });
}

export async function getSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessions = await authService.getSessions(request.user.id);
  reply.send({ success: true, data: sessions });
}

export async function forceLogoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authService.forceLogoutAll(request.user.id);
  clearSessionCookies(reply);
  reply.send({ success: true, data: null });
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rt = request.cookies[RT_NAME];
  if (!rt) {
    return reply.code(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'No refresh token provided.' },
    });
  }
  const tokens = await authService.refresh(rt);
  setSessionCookies(reply, tokens.refreshToken);
  reply.send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin, profileCompleted: tokens.profileCompleted },
  });
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const refreshToken = request.cookies?.[RT_NAME];
  if (refreshToken) {
    await authService.logoutByRefreshToken(refreshToken);
  } else {
    // Fallback: use the access token from Authorization header.
    // Decoded without signature verification — we only need the userId to revoke tokens.
    // Used when the httpOnly cookie is not sent (e.g. keepalive fetch during page unload).
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.decode(authHeader.slice(7)) as { id?: string } | null;
        if (payload?.id) await authService.logout(payload.id);
      } catch { /* ignore */ }
    }
  }
  clearSessionCookies(reply);
  reply.send({ success: true, data: null });
}
