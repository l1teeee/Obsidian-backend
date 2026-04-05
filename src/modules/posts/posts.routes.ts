import { FastifyPluginAsync } from 'fastify';
import * as controller from './posts.controller';
import {
  createPostSchema,
  deletePostSchema,
  getPostByIdSchema,
  getPostsSchema,
  updatePostSchema,
} from './posts.schema';

const postsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', { schema: getPostsSchema }, controller.getPostsHandler);

  fastify.get('/:id', { schema: getPostByIdSchema }, controller.getPostByIdHandler);

  fastify.post('/', { schema: createPostSchema }, controller.createPostHandler);

  fastify.put('/:id', { schema: updatePostSchema }, controller.updatePostHandler);

  fastify.get('/:id/metrics', { schema: getPostByIdSchema }, controller.getPostMetricsHandler);

  fastify.patch('/:id/deactivate', controller.deactivatePostHandler);

  fastify.delete('/:id', { schema: deletePostSchema }, controller.deletePostHandler);
};

export default postsRoutes;
