import { FastifyInstance } from 'fastify';
import { inspireHandler, generateImageHandler } from './ai.controller';
import { inspireSchema, generateImageSchema } from './ai.schema';

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/inspire',        { schema: inspireSchema       }, inspireHandler       );
  fastify.post('/generate-image', { schema: generateImageSchema }, generateImageHandler );
}
