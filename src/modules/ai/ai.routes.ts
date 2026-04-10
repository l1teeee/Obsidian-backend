import { FastifyInstance } from 'fastify';
import { inspireHandler, generateImageHandler, editImageHandler, suggestTimeHandler, analyzeImageHandler } from './ai.controller';
import { inspireSchema, generateImageSchema, editImageSchema, suggestTimeSchema, analyzeImageSchema } from './ai.schema';

const AI_LIMIT = { max: 20, timeWindow: '1 minute' };

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/inspire',        { schema: inspireSchema,       config: { rateLimit: AI_LIMIT } }, inspireHandler      );
  fastify.post('/generate-image', { schema: generateImageSchema, config: { rateLimit: AI_LIMIT } }, generateImageHandler);
  fastify.post('/edit-image',     { schema: editImageSchema,     config: { rateLimit: AI_LIMIT } }, editImageHandler    );
  fastify.post('/suggest-time',   { schema: suggestTimeSchema,   config: { rateLimit: AI_LIMIT } }, suggestTimeHandler  );
  fastify.post('/analyze-image',  { schema: analyzeImageSchema,  config: { rateLimit: AI_LIMIT } }, analyzeImageHandler );
}
