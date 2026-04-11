import { FastifyPluginAsync } from 'fastify';
import { getMeHandler, completeProfileHandler } from './users.controller';

const completeProfileSchema = {
  body: {
    type: 'object',
    required: ['name', 'role', 'country'],
    additionalProperties: false,
    properties: {
      name:    { type: 'string', minLength: 1, maxLength: 100 },
      role:    { type: 'string', minLength: 1, maxLength: 100 },
      country: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
};

const USERS_LIMIT = { max: 60, timeWindow: '1 minute' };

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/me',  { config: { rateLimit: USERS_LIMIT } }, getMeHandler);
  fastify.put('/me',  { schema: completeProfileSchema, config: { rateLimit: USERS_LIMIT } }, completeProfileHandler);
};

export default usersRoutes;
