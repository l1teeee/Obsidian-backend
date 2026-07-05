import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getSubscriptionState } from '../modules/payments/subscriptions.service';

const subscriptionPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'requireSubscription',
    async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      // Unauthenticated routes in guarded modules (OAuth callbacks) are skipped —
      // they validate access through their own signed state parameter.
      if (!request.user) return;

      const state = await getSubscriptionState(request.user.id);
      if (state.status === 'blocked') {
        throw Object.assign(
          new Error('Your free trial has ended. An active subscription is required.'),
          { statusCode: 402, errorCode: 'SUBSCRIPTION_REQUIRED' },
        );
      }
      request.subscription = state;
    },
  );
};

export default fp(subscriptionPlugin);
