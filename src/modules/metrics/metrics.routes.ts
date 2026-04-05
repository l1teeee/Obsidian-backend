import { FastifyInstance } from 'fastify';
import { getFacebookSummary, getFacebookPosts } from './metrics.controller';

export default async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/facebook/summary',
    { onRequest: [fastify.authenticate] },
    getFacebookSummary,
  );

  fastify.get(
    '/facebook/posts',
    { onRequest: [fastify.authenticate] },
    getFacebookPosts,
  );
}
