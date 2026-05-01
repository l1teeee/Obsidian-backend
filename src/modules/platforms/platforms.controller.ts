import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env';
import * as platformsService from './platforms.service';

// ─── List connections ─────────────────────────────────────────────────────────

export async function getConnections(
  req: FastifyRequest<{ Querystring: { workspaceId?: string } }>,
  reply: FastifyReply,
) {
  const userId     = (req.user as { id: string }).id;
  const workspaceId = req.query.workspaceId ?? null;
  const connections = await platformsService.listConnections(userId, workspaceId);
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

export async function connectInstagramFromPages(
  req: FastifyRequest<{ Querystring: { workspaceId?: string } }>,
  reply: FastifyReply,
) {
  const userId     = (req.user as { id: string }).id;
  const workspaceId = req.query.workspaceId ?? null;
  const count      = await platformsService.linkInstagramFromExistingPages(userId, workspaceId);
  if (count === 0) {
    return reply.code(404).send({
      success: false,
      error: { code: 'NO_IG_FOUND', message: 'No Instagram accounts found linked to your Facebook pages.' },
    });
  }
  reply.send({ success: true, data: { linked: count } });
}

// ─── Initiate Facebook OAuth ──────────────────────────────────────────────────

export async function initFacebookOAuth(
  req: FastifyRequest<{ Querystring: { workspaceId?: string } }>,
  reply: FastifyReply,
) {
  if (!env.FACEBOOK_CLIENT_ID) {
    return reply.code(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Facebook OAuth is not configured' } });
  }

  const userId     = (req.user as { id: string }).id;
  const workspaceId = req.query.workspaceId ?? null;
  const state      = req.server.jwt.sign({ userId, workspaceId, ts: Date.now() }, { expiresIn: '10m' });

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
  authUrl.searchParams.set('auth_nonce',    String(Date.now()));
  authUrl.searchParams.set('return_scopes', 'true');

  reply.send({ success: true, data: { url: authUrl.toString() } });
}

// ─── Instagram direct OAuth (Camino B) ───────────────────────────────────────

export async function initInstagramDirectOAuth(
  req: FastifyRequest<{ Querystring: { workspaceId?: string } }>,
  reply: FastifyReply,
) {
  if (!env.FACEBOOK_CLIENT_ID) {
    return reply.code(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Instagram OAuth is not configured' } });
  }

  const userId     = (req.user as { id: string }).id;
  const workspaceId = req.query.workspaceId ?? null;
  const state      = req.server.jwt.sign({ userId, workspaceId, ts: Date.now() }, { expiresIn: '10m' });

  const scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ].join(',');

  const authUrl = new URL('https://www.instagram.com/oauth/authorize');
  authUrl.searchParams.set('client_id',     env.FACEBOOK_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  env.INSTAGRAM_REDIRECT_URL);
  authUrl.searchParams.set('scope',         scopes);
  authUrl.searchParams.set('state',         state);
  authUrl.searchParams.set('response_type', 'code');

  reply.send({ success: true, data: { url: authUrl.toString() } });
}

export async function instagramDirectOAuthCallback(
  req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>,
  reply: FastifyReply,
) {
  const { code, state, error } = req.query;
  const frontendUrl = env.FRONTEND_URL;

  if (error || !code || !state) {
    const msg = req.query.error_description ?? error ?? 'OAuth cancelled';
    return reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent(msg)}`);
  }

  let userId: string;
  let workspaceId: string | null;
  try {
    const payload = req.server.jwt.verify<{ userId: string; workspaceId?: string | null }>(state);
    userId      = payload.userId;
    workspaceId = payload.workspaceId ?? null;
  } catch {
    return reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent('Invalid OAuth state')}`);
  }

  try {
    await platformsService.handleInstagramDirectCallback(userId, code, workspaceId);
    reply.redirect(`${frontendUrl}/platforms?connected=success`);
  } catch (err) {
    const msg = (err as Error).message ?? 'Failed to connect Instagram account';
    reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent(msg)}`);
  }
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
  let workspaceId: string | null;
  try {
    const payload = req.server.jwt.verify<{ userId: string; workspaceId?: string | null }>(state);
    userId      = payload.userId;
    workspaceId = payload.workspaceId ?? null;
  } catch {
    return reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent('Invalid OAuth state')}`);
  }

  try {
    await platformsService.handleFacebookCallback(userId, code, granted_scopes, workspaceId);
    reply.redirect(`${frontendUrl}/platforms?connected=success`);
  } catch (err) {
    const msg = (err as Error).message ?? 'Failed to connect account';
    reply.redirect(`${frontendUrl}/platforms?error=${encodeURIComponent(msg)}`);
  }
}
