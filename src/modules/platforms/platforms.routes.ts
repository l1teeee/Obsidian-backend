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

export default async function platformsRoutes(fastify: FastifyInstance) {
  // All routes below require authentication except the callback (verified via state JWT)
  fastify.get(
    '/',
    { onRequest: [fastify.authenticate] },
    getConnections,
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    disconnect,
  );

  // Connect Instagram from existing FB page tokens (no new OAuth required)
  fastify.get(
    '/connect/instagram',
    { onRequest: [fastify.authenticate] },
    connectInstagramFromPages,
  );

  // Initiates Facebook OAuth → redirects user to Facebook
  fastify.get(
    '/connect/facebook',
    { onRequest: [fastify.authenticate] },
    initFacebookOAuth,
  );

  // Facebook calls this back after user grants permission (no auth header here)
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/connect/facebook/callback',
    facebookOAuthCallback,
  );

  // Instagram direct OAuth (Camino B — no Facebook required)
  fastify.get(
    '/connect/instagram/oauth',
    { onRequest: [fastify.authenticate] },
    initInstagramDirectOAuth,
  );

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/connect/instagram/oauth/callback',
    instagramDirectOAuthCallback,
  );
}
