import { FastifyPluginAsync } from 'fastify';
import {
  getMeHandler,
  completeProfileHandler,
  updateProfileHandler,
  updatePlanHandler,
  getPlatformsHandler,
  getActivityHandler,
  getAllActivityHandler,
  updateAvatarHandler,
} from './users.controller';

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

const updateProfileSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name:    { type: 'string', minLength: 1, maxLength: 100 },
      role:    { type: 'string', minLength: 0, maxLength: 100 },
      country: { type: 'string', minLength: 0, maxLength: 100 },
    },
  },
};

const updatePlanSchema = {
  body: {
    type: 'object',
    required: ['plan'],
    additionalProperties: false,
    properties: {
      plan: { type: 'string', enum: ['starter', 'pro', 'enterprise'] },
    },
  },
};

const updateAvatarSchema = {
  body: {
    type: 'object',
    required: ['avatar_url'],
    additionalProperties: false,
    properties: {
      avatar_url: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
};

const USERS_LIMIT = { max: 60, timeWindow: '1 minute' };

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/me',        { config: { rateLimit: USERS_LIMIT } },                              getMeHandler);
  fastify.put('/me',        { schema: completeProfileSchema, config: { rateLimit: USERS_LIMIT } }, completeProfileHandler);
  fastify.patch('/me',      { schema: updateProfileSchema,   config: { rateLimit: USERS_LIMIT } }, updateProfileHandler);
  fastify.patch('/me/plan',      { schema: updatePlanSchema, config: { rateLimit: USERS_LIMIT } }, updatePlanHandler);
  fastify.get('/me/platforms',       { config: { rateLimit: USERS_LIMIT } }, getPlatformsHandler);
  fastify.get('/me/activity',        { config: { rateLimit: USERS_LIMIT } }, getActivityHandler);
  fastify.get('/me/activity/all',    { config: { rateLimit: USERS_LIMIT } }, getAllActivityHandler);
  fastify.patch('/me/avatar',        { schema: updateAvatarSchema, config: { rateLimit: USERS_LIMIT } }, updateAvatarHandler);
};

export default usersRoutes;
