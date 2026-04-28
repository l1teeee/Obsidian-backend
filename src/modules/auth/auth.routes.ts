import { FastifyPluginAsync } from 'fastify';
import * as controller from './auth.controller';
import { loginSchema, refreshSchema, registerSchema, resendVerificationSchema, verifyEmailSchema } from './auth.schema';

const STRICT_LIMIT  = { max: 10, timeWindow: '1 minute' };   // login / register
const REFRESH_LIMIT = { max: 30, timeWindow: '1 minute' };   // refresh (legitimate clients retry often)

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/register', {
    config: { rateLimit: STRICT_LIMIT },
    schema: registerSchema,
  }, controller.registerHandler);

  fastify.post('/verify-email', {
    config: { rateLimit: STRICT_LIMIT },
    schema: verifyEmailSchema,
  }, controller.verifyEmailHandler);

  fastify.post('/resend-verification', {
    config: { rateLimit: STRICT_LIMIT },
    schema: resendVerificationSchema,
  }, controller.resendVerificationHandler);

  fastify.post('/login', {
    config: { rateLimit: STRICT_LIMIT },
    schema: loginSchema,
  }, controller.loginHandler);

  fastify.post('/google', {
    config: { rateLimit: STRICT_LIMIT },
  }, controller.googleLoginHandler);

  fastify.post('/refresh', {
    config: { rateLimit: REFRESH_LIMIT },
    schema: refreshSchema,
  }, controller.refreshHandler);

  fastify.post(
    '/logout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    controller.logoutHandler,
  );

  fastify.get(
    '/ping',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    controller.pingHandler,
  );

  fastify.get(
    '/sessions',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    controller.getSessionsHandler,
  );

  fastify.post(
    '/force-logout',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    controller.forceLogoutHandler,
  );
};

export default authRoutes;
