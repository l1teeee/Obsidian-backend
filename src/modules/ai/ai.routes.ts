import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { inspireHandler, generateImageHandler, editImageHandler, suggestTimeHandler, analyzeImageHandler, carouselSlidesHandler } from './ai.controller';
import { inspireSchema, generateImageSchema, editImageSchema, suggestTimeSchema, analyzeImageSchema, carouselSlidesSchema } from './ai.schema';
import { checkTokenLimit } from '../admin/token.service';
import { getMe } from '../users/users.service';

const AI_LIMIT = { max: 20, timeWindow: '1 minute' };

async function tokenLimitGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await getMe(request.user.id);
  const { allowed, used, limit } = await checkTokenLimit(request.user.id, user.plan);
  if (!allowed) {
    reply.status(429).send({
      success: false,
      error: { code: 'TOKEN_LIMIT_EXCEEDED', message: 'Monthly token limit reached', used, limit },
    });
  }
}

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/inspire',        { schema: inspireSchema,       config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, inspireHandler      );
  fastify.post('/generate-image', { schema: generateImageSchema, config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, generateImageHandler);
  fastify.post('/edit-image',     { schema: editImageSchema,     config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, editImageHandler    );
  fastify.post('/suggest-time',   { schema: suggestTimeSchema,   config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, suggestTimeHandler  );
  fastify.post('/analyze-image',  { schema: analyzeImageSchema,  config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, analyzeImageHandler );
  fastify.post('/carousel-slides',{ schema: carouselSlidesSchema,config: { rateLimit: AI_LIMIT }, preHandler: [tokenLimitGuard] }, carouselSlidesHandler);
}
