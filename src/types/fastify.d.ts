import { FastifyRequest, FastifyReply } from 'fastify';
import type { SubscriptionState } from '../modules/payments/subscription-state';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id:    string;
      email: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate:        (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    subscription?: SubscriptionState;
  }
}
