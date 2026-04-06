import { FastifyInstance } from 'fastify';
import { getFacebookSummary, getFacebookPosts, getFacebookPostById } from './metrics.controller';

export default async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/facebook/summary',         { onRequest: [fastify.authenticate] }, getFacebookSummary);
  fastify.get('/facebook/posts',           { onRequest: [fastify.authenticate] }, getFacebookPosts);
  fastify.get<{ Params: { postId: string } }>(
    '/facebook/posts/:postId',
    { onRequest: [fastify.authenticate] },
    getFacebookPostById,
  );
}
