import { FastifyPluginAsync } from 'fastify';
import * as controller from './payments.controller';
import { confirmSubscriptionSchema } from './payments.schema';

const paymentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/subscription', {
    preHandler: [fastify.authenticate],
    config:     { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, controller.getSubscriptionHandler);

  fastify.post('/paypal/subscription', {
    preHandler: [fastify.authenticate],
    config:     { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema:     confirmSubscriptionSchema,
  }, controller.confirmSubscriptionHandler);

  fastify.post('/paypal/subscription/cancel', {
    preHandler: [fastify.authenticate],
    config:     { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, controller.cancelSubscriptionHandler);

  fastify.post('/paypal/webhook', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, controller.webhookHandler);
};

export default paymentsRoutes;
