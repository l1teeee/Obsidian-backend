import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { uploadHandler } from './media.controller';

export default async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  // Register multipart scoped to this plugin only — doesn't affect other routes
  await fastify.register(multipart);

  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/upload', uploadHandler);
}
