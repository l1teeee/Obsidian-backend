import Fastify, { FastifyError } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import { env } from './config/env';
import authenticatePlugin from './plugins/jwt.plugin';
import authRoutes from './modules/auth/auth.routes';
import postsRoutes from './modules/posts/posts.routes';
import workspacesRoutes from './modules/workspaces/workspaces.routes';

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
    const message =
      statusCode >= 500 ? 'An unexpected error occurred' : error.message;

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

  return fastify;
}
