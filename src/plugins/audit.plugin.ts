import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

// ── Config ───────────────────────────────────────────────────────────────────

/** Auth endpoints that always get logged regardless of status code. */
const AUTH_ROUTES = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/logout',
  '/auth/force-logout',
  '/auth/refresh',
  '/auth/verify-email',
]);

/** Methods that carry no payload — skip detailed logging. */
const SKIP_METHODS = new Set(['OPTIONS', 'HEAD']);

// ── Plugin ───────────────────────────────────────────────────────────────────

const auditPlugin: FastifyPluginAsync = async (fastify) => {
  // Track request start time for duration calculation.
  fastify.addHook('onRequest', async (request) => {
    (request as unknown as { _startAt: number })._startAt = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (SKIP_METHODS.has(request.method)) return;

    const durationMs = Date.now() - ((request as unknown as { _startAt: number })._startAt ?? Date.now());

    // Extract userId from verified JWT payload (undefined if unauthenticated).
    const userId = (request.user as { id?: string } | undefined)?.id ?? null;

    // Match against route template (e.g. /posts/:id) when available.
    const routePath: string =
      (request.routeOptions as { url?: string } | undefined)?.url ??
      request.url.split('?')[0];

    const isAuthRoute = AUTH_ROUTES.has(routePath);
    const isError     = reply.statusCode >= 400;
    const isServerErr = reply.statusCode >= 500;

    const entry = {
      requestId:  request.id,
      method:     request.method,
      route:      routePath,
      statusCode: reply.statusCode,
      durationMs,
      ip:         request.ip,
      userId,
      // Truncate user-agent to avoid log bloat and injection.
      ua: (request.headers['user-agent'] ?? '').slice(0, 200) || null,
      ...(isAuthRoute && { event: 'auth' }),
    };

    if (isServerErr) {
      request.log.error(entry, '[audit] server error');
    } else if (isAuthRoute || isError) {
      request.log.warn(entry, isAuthRoute ? '[audit] auth event' : '[audit] client error');
    } else {
      request.log.info(entry, '[audit] request');
    }
  });
};

export default fp(auditPlugin, { name: 'audit' });
