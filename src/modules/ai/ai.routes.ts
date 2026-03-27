import { FastifyInstance } from 'fastify';
import { inspireHandler, generateImageHandler, suggestTimeHandler } from './ai.controller';
import { inspireSchema, generateImageSchema, suggestTimeSchema } from './ai.schema';

const AI_LIMIT = { max: 20, timeWindow: '1 minute' };

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/inspire',        { schema: inspireSchema,       config: { rateLimit: AI_LIMIT } }, inspireHandler      );
  fastify.post('/generate-image', { schema: generateImageSchema, config: { rateLimit: AI_LIMIT } }, generateImageHandler);
  fastify.post('/suggest-time',   { schema: suggestTimeSchema,   config: { rateLimit: AI_LIMIT } }, suggestTimeHandler  );
}
