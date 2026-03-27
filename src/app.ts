import Fastify, { FastifyError } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import { env } from './config/env';
import authenticatePlugin from './plugins/jwt.plugin';
import authRoutes from './modules/auth/auth.routes';
import postsRoutes from './modules/posts/posts.routes';
import workspacesRoutes from './modules/workspaces/workspaces.routes';
import aiRoutes from './modules/ai/ai.routes';
import aiSettingsRoutes from './modules/ai-settings/ai-settings.routes';

interface AppError extends FastifyError {
  errorCode?: string;
}

export function buildApp() {
  const fastify = Fastify({ logger: true });

  fastify.register(jwtPlugin, { secret: env.JWT_SECRET });

  fastify.register(authenticatePlugin);

  fastify.setErrorHandler((error: AppError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.errorCode ?? (statusCode < 500 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
    // Only mask message for truly unexpected errors (no errorCode = not thrown intentionally)
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

  fastify.register(authRoutes,       { prefix: '/auth' });
  fastify.register(postsRoutes,      { prefix: '/posts' });
  fastify.register(workspacesRoutes, { prefix: '/workspaces' });
  fastify.register(aiRoutes,         { prefix: '/ai' });
  fastify.register(aiSettingsRoutes, { prefix: '/ai-settings' });

  return fastify;
}
