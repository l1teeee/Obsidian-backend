import { FastifyInstance } from 'fastify';
import {
  getConnections,
  disconnect,
  initFacebookOAuth,
  facebookOAuthCallback,
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
}
