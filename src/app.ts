import Fastify, { FastifyError } from 'fastify';
import cors        from '@fastify/cors';
import helmet      from '@fastify/helmet';
import rateLimit   from '@fastify/rate-limit';
import cookie      from '@fastify/cookie';
import jwtPlugin   from '@fastify/jwt';
import { env }  from './config/env';
import { pool } from './config/db';
import authenticatePlugin from './plugins/jwt.plugin';
import authRoutes         from './modules/auth/auth.routes';
import postsRoutes        from './modules/posts/posts.routes';
import workspacesRoutes   from './modules/workspaces/workspaces.routes';
import aiRoutes           from './modules/ai/ai.routes';
import aiSettingsRoutes   from './modules/ai-settings/ai-settings.routes';
import mediaRoutes        from './modules/media/media.routes';
import usersRoutes        from './modules/users/users.routes';
import platformsRoutes    from './modules/platforms/platforms.routes';
import metricsRoutes      from './modules/metrics/metrics.routes';

interface AppError extends FastifyError {
  errorCode?: string;
}

export function buildApp() {
  const fastify = Fastify({ logger: true });

  // ── Security headers ────────────────────────────────────────────────────────
  fastify.register(helmet, {
    contentSecurityPolicy:      false,   // REST API — no HTML
    crossOriginEmbedderPolicy:  false,
    crossOriginResourcePolicy:  { policy: 'cross-origin' },
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  fastify.register(cors, {
    origin:      env.CORS_ORIGINS.split(',').map(o => o.trim()),
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Rate limiting (global=false → only applied per-route when configured) ──
  fastify.register(rateLimit, {
    global:    false,
    keyGenerator: (req) => req.ip,
  });

  // ── Cookies (httpOnly refresh token) ────────────────────────────────────────
  fastify.register(cookie, { secret: env.COOKIE_SECRET });

  // ── JWT ─────────────────────────────────────────────────────────────────────
  fastify.register(jwtPlugin, { secret: env.JWT_SECRET });

  fastify.register(authenticatePlugin);

  // ── Global error handler ─────────────────────────────────────────────────────
  fastify.setErrorHandler((error: AppError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.errorCode ?? (statusCode < 500 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
    const message = statusCode >= 500 && !error.errorCode
      ? 'An unexpected error occurred'
      : error.message;

    if (statusCode >= 500) {
      _request.log.error(error);
    }

    reply.code(statusCode).send({
      success: false,
      error: { code, message },
    });
  });

  // ── Health check ────────────────────────────────────────────────────────────
  fastify.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      reply.send({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      reply.code(503).send({ status: 'unavailable' });
    }
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  fastify.register(authRoutes,       { prefix: '/auth' });
  fastify.register(postsRoutes,      { prefix: '/posts' });
  fastify.register(workspacesRoutes, { prefix: '/workspaces' });
  fastify.register(aiRoutes,         { prefix: '/ai' });
  fastify.register(aiSettingsRoutes, { prefix: '/ai-settings' });
  fastify.register(mediaRoutes,      { prefix: '/media' });
  fastify.register(usersRoutes,      { prefix: '/users' });
  fastify.register(platformsRoutes,  { prefix: '/platforms' });
  fastify.register(metricsRoutes,    { prefix: '/metrics' });

  return fastify;
}
