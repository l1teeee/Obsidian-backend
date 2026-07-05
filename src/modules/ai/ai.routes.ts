import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { inspireHandler, generateImageHandler, editImageHandler, suggestTimeHandler, analyzeImageHandler, carouselSlidesHandler } from './ai.controller';
import { inspireSchema, generateImageSchema, editImageSchema, suggestTimeSchema, analyzeImageSchema, carouselSlidesSchema } from './ai.schema';
import { checkTokenLimit } from '../admin/token.service';

const AI_LIMIT = { max: 20, timeWindow: '1 minute' };

async function tokenLimitGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // requireSubscription ran before this hook, so subscription is populated.
  // Trial users get the trial tier's allowance instead of "no plan = unlimited".
  const plan = request.subscription?.effectivePlan ?? null;
  const { allowed, used, limit } = await checkTokenLimit(request.user.id, plan);
  if (!allowed) {
    reply.status(429).send({
      success: false,
      error: { code: 'TOKEN_LIMIT_EXCEEDED', message: 'Monthly token limit reached', used, limit },
    });
  }
}

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireSubscription);
  fastify.addHook('preHandler', tokenLimitGuard);

  fastify.post('/inspire',        { schema: inspireSchema,       config: { rateLimit: AI_LIMIT } }, inspireHandler      );
  fastify.post('/generate-image', { schema: generateImageSchema, config: { rateLimit: AI_LIMIT } }, generateImageHandler);
  fastify.post('/edit-image',     { schema: editImageSchema,     config: { rateLimit: AI_LIMIT } }, editImageHandler    );
  fastify.post('/suggest-time',   { schema: suggestTimeSchema,   config: { rateLimit: AI_LIMIT } }, suggestTimeHandler  );
  fastify.post('/analyze-image',  { schema: analyzeImageSchema,  config: { rateLimit: AI_LIMIT } }, analyzeImageHandler );
  fastify.post('/carousel-slides',{ schema: carouselSlidesSchema,config: { rateLimit: AI_LIMIT } }, carouselSlidesHandler);
}
