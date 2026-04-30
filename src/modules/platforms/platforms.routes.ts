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

type WsQuery    = { Querystring: { workspaceId?: string } };
type CallbackQs = { Querystring: { code?: string; state?: string; error?: string; error_description?: string } };
type FbCallbackQs = { Querystring: { code?: string; state?: string; error?: string; error_description?: string; granted_scopes?: string } };

export default async function platformsRoutes(fastify: FastifyInstance) {
  fastify.get<WsQuery>(
    '/',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    getConnections,
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    disconnect,
  );

  fastify.get<WsQuery>(
    '/connect/instagram',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    connectInstagramFromPages,
  );

  fastify.get<WsQuery>(
    '/connect/facebook',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    initFacebookOAuth,
  );

  fastify.get<FbCallbackQs>(
    '/connect/facebook/callback',
    { config: { rateLimit: CALLBACK_LIMIT } },
    facebookOAuthCallback,
  );

  fastify.get<WsQuery>(
    '/connect/instagram/oauth',
    { onRequest: [fastify.authenticate], config: { rateLimit: API_LIMIT } },
    initInstagramDirectOAuth,
  );

  fastify.get<CallbackQs>(
    '/connect/instagram/oauth/callback',
    { config: { rateLimit: CALLBACK_LIMIT } },
    instagramDirectOAuthCallback,
  );
}
