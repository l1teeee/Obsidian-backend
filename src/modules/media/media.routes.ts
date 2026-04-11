import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { uploadHandler, presignHandler } from './media.controller';

export default async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  // Register multipart scoped to this plugin only — doesn't affect other routes
  await fastify.register(multipart);

  fastify.addHook('preHandler', fastify.authenticate);

  // Server-side upload: backend receives file, stores in S3
  fastify.post('/upload', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, uploadHandler);

  // Presigned URL: frontend uploads directly to S3 (preferred for large videos)
  fastify.post('/presign', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, presignHandler);
}
