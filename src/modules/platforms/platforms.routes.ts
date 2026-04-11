import { FastifyInstance } from 'fastify';
import {
  getConnections,
  disconnect,
  connectInstagramFromPages,
  initFacebookOAuth,
  facebookOAuthCallback,
  initInstagramDirectOAuth,
  instagramDirectOAuthCallback,
} from './platforms.controller';

const API_LIMIT      = { max: 30, timeWindow: '1 minute' };
const CALLBACK_LIMIT = { max: 10, timeWindow: '1 minute' };

export default async function platformsRoutes(fastify: FastifyInstance) {
  // All routes below require authentication except the callbacks (verified via state JWT)
  fastify.get(
    '/',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    getConnections,
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    disconnect,
  );

  // Connect Instagram from existing FB page tokens (no new OAuth required)
  fastify.get(
    '/connect/instagram',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    connectInstagramFromPages,
  );

  // Initiates Facebook OAuth → redirects user to Facebook
  fastify.get(
    '/connect/facebook',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    initFacebookOAuth,
  );

  // Facebook calls this back after user grants permission (no auth header here)
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/connect/facebook/callback',
    { config: { rateLimit: CALLBACK_LIMIT } },
    facebookOAuthCallback,
  );

  // Instagram direct OAuth (Camino B — no Facebook required)
  fastify.get(
    '/connect/instagram/oauth',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    initInstagramDirectOAuth,
  );

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/connect/instagram/oauth/callback',
    { config: { rateLimit: CALLBACK_LIMIT } },
    instagramDirectOAuthCallback,
  );
}
