import { FastifyReply, FastifyRequest } from 'fastify';
import * as authService from './auth.service';

const COOKIE_NAME = 'obs_rt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env['NODE_ENV'] === 'production',
  sameSite: 'lax' as const,
  path:     '/auth',
  maxAge:   7 * 24 * 60 * 60,   // 7 days in seconds
};

type RegisterBody = { email: string; password: string; name: string };
type LoginBody    = { email: string; password: string; rememberMe?: boolean };

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/auth' });
}

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
): Promise<void> {
  const tokens = await authService.register(
    request.body.email,
    request.body.password,
    request.body.name,
  );
  setRefreshCookie(reply, tokens.refreshToken);
  reply.code(201).send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin },
  });
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { email, password, rememberMe = true } = request.body;
  const tokens = await authService.login(email, password);

  // rememberMe=true → persistent cookie (7 days); false → session cookie (closes with browser)
  reply.setCookie(COOKIE_NAME, tokens.refreshToken, {
    ...COOKIE_OPTS,
    maxAge: rememberMe ? COOKIE_OPTS.maxAge : undefined,
  });

  reply.send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin },
  });
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rt = request.cookies[COOKIE_NAME];
  if (!rt) {
    return reply.code(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'No refresh token provided.' },
    });
  }
  const tokens = await authService.refresh(rt);
  setRefreshCookie(reply, tokens.refreshToken);
  reply.send({
    success: true,
    data: { accessToken: tokens.accessToken, isFirstLogin: tokens.isFirstLogin },
  });
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authService.logout(request.user.id);
  clearRefreshCookie(reply);
  reply.send({ success: true, data: null });
}
