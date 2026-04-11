import { FastifyPluginAsync } from 'fastify';
import * as controller from './posts.controller';
import {
  createPostSchema,
  deletePostSchema,
  getPostByIdSchema,
  getPostsSchema,
  updatePostSchema,
} from './posts.schema';

const READ_LIMIT  = { max: 120, timeWindow: '1 minute' };
const WRITE_LIMIT = { max: 30,  timeWindow: '1 minute' };

const postsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/',    { schema: getPostsSchema,    config: { rateLimit: READ_LIMIT  } }, controller.getPostsHandler);
  fastify.get('/:id', { schema: getPostByIdSchema, config: { rateLimit: READ_LIMIT  } }, controller.getPostByIdHandler);
  fastify.post('/',   { schema: createPostSchema,  config: { rateLimit: WRITE_LIMIT } }, controller.createPostHandler);
  fastify.put('/:id', { schema: updatePostSchema,  config: { rateLimit: WRITE_LIMIT } }, controller.updatePostHandler);

  fastify.get('/:id/metrics',      { schema: getPostByIdSchema, config: { rateLimit: READ_LIMIT  } }, controller.getPostMetricsHandler);
  fastify.patch('/:id/deactivate', {                            config: { rateLimit: WRITE_LIMIT } }, controller.deactivatePostHandler);
  fastify.delete('/:id',           { schema: deletePostSchema,  config: { rateLimit: WRITE_LIMIT } }, controller.deletePostHandler);
};

export default postsRoutes;
