import { FastifyPluginAsync } from 'fastify';
import * as controller from './auth.controller';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema';

const STRICT_LIMIT  = { max: 10, timeWindow: '1 minute' };   // login / register
const REFRESH_LIMIT = { max: 30, timeWindow: '1 minute' };   // refresh (legitimate clients retry often)

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/register', {
    config: { rateLimit: STRICT_LIMIT },
    schema: registerSchema,
  }, controller.registerHandler);

  fastify.post('/login', {
    config: { rateLimit: STRICT_LIMIT },
    schema: loginSchema,
  }, controller.loginHandler);

  fastify.post('/refresh', {
    config: { rateLimit: REFRESH_LIMIT },
    schema: refreshSchema,
  }, controller.refreshHandler);

  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    controller.logoutHandler,
  );
};

export default authRoutes;
