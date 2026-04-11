import { FastifyInstance } from 'fastify';
import { getDashboardSummary, getFacebookSummary, getFacebookPosts, getFacebookPostById } from './metrics.controller';

const METRICS_LIMIT = { max: 30, timeWindow: '1 minute' };

export default async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/dashboard/summary',        { onRequest: [fastify.authenticate], config: { rateLimit: METRICS_LIMIT } }, getDashboardSummary);
  fastify.get('/facebook/summary',         { onRequest: [fastify.authenticate], config: { rateLimit: METRICS_LIMIT } }, getFacebookSummary);
  fastify.get('/facebook/posts',           { onRequest: [fastify.authenticate], config: { rateLimit: METRICS_LIMIT } }, getFacebookPosts);
  fastify.get<{ Params: { postId: string } }>(
    '/facebook/posts/:postId',
    { onRequest: [fastify.authenticate], config: { rateLimit: METRICS_LIMIT } },
    getFacebookPostById,
  );
}
