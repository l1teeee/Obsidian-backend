import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env';
import * as platformsService from './platforms.service';

// ─── List connections ─────────────────────────────────────────────────────────

export async function getConnections(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id: string }).id;
  const connections = await platformsService.listConnections(userId);
  reply.send({ success: true, data: connections });
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnect(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const userId = (req.user as { id: string }).id;
  await platformsService.deleteConnection(req.params.id, userId);
  reply.send({ success: true });
}

// ─── Connect Instagram from existing FB pages ─────────────────────────────────

export async function connectInstagramFromPages(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id: string }).id;
  const count  = await platformsService.linkInstagramFromExistingPages(userId);
  if (count === 0) {
    return reply.code(404).send({
      success: false,
      error: { code: 'NO_IG_FOUND', message: 'No Instagram accounts found linked to your Facebook pages.' },
    });
  }
  reply.send({ success: true, data: { linked: count } });
}

// ─── Initiate Facebook OAuth ──────────────────────────────────────────────────

export async function initFacebookOAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!env.FACEBOOK_CLIENT_ID) {
    return reply.code(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Facebook OAuth is not configured' } });
  }

  // JWT-signed state for CSRF protection
  const userId = (req.user as { id: string }).id;
  const state  = req.server.jwt.sign({ userId, ts: Date.now() }, { expiresIn: '10m' });

  const scopes = [
    'email',
    'public_profile',
    'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'read_insights',
    'instagram_basic',
  ].join(',');

  const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  authUrl.searchParams.set('client_id',     env.FACEBOOK_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  env.FACEBOOK_REDIRECT_URL);
  authUrl.searchParams.set('scope',         scopes);
  authUrl.searchParams.set('state',         state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('auth_type',     'reauthorize');
  authUrl.searchParams.set('return_scopes', 'true');
  authUrl.searchParams.set('auth_nonce',    String(Date.now()));

  reply.send({ success: true, data: { url: authUrl.toString() } });
}

// ─── Facebook OAuth callback ──────────────────────────────────────────────────

export async function facebookOAuthCallback(
  req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string; granted_scopes?: string } }>,
  reply: FastifyReply,
) {
  const { code, state, error, granted_scopes } = req.query;
  const frontendUrl = env.FRONTEND_URL;

  if (error || !code || !state) {
    const msg = req.query.error_description ?? error ?? 'OAuth cancelled';
    return reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent(msg)}`);
  }

  // Verify state JWT (signed by our server, carries userId for CSRF protection)
  let userId: string;
  try {
    const payload = req.server.jwt.verify<{ userId: string }>(state);
    userId = payload.userId;
  } catch {
    return reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent('Invalid OAuth state')}`);
  }

  try {
    await platformsService.handleFacebookCallback(userId, code, granted_scopes);
    reply.redirect(`${frontendUrl}/platforms?connected=success`);
  } catch (err) {
    const msg = (err as Error).message ?? 'Failed to connect account';
    reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent(msg)}`);
  }
}
