import { FastifyPluginAsync } from 'fastify';
import * as controller from './auth.controller';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/register', { schema: registerSchema }, controller.registerHandler);

  fastify.post('/login', { schema: loginSchema }, controller.loginHandler);

  fastify.post('/refresh', { schema: refreshSchema }, controller.refreshHandler);

  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    controller.logoutHandler
  );
};

export default authRoutes;
