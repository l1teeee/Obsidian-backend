import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import {
  getOverviewHandler,
  getUsersHandler,
  getWorkspacesHandler,
  getPostsHandler,
  deactivatePostHandler,
  activatePostHandler,
  deactivateUserHandler,
  activateUserHandler,
  deactivateWorkspaceHandler,
  activateWorkspaceHandler,
  getAdminsHandler,
  addAdminHandler,
  removeAdminHandler,
  respondToInviteHandler,
} from './admin.controller';
import { initAdminTables } from './admin.service';

interface AdminRow extends RowDataPacket { is_admin: number; is_superadmin: number }

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const [rows] = await pool.query<AdminRow[]>(
    'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
    [request.user.id],
  );
  if (!rows[0]?.is_admin) {
    reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
}

async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const [rows] = await pool.query<AdminRow[]>(
    'SELECT is_superadmin FROM users WHERE id = ? LIMIT 1',
    [request.user.id],
  );
  if (!rows[0]?.is_superadmin) {
    reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Superadmin access required' } });
  }
}

const ADMIN_LIMIT  = { max: 120, timeWindow: '1 minute' };
const PUBLIC_LIMIT = { max: 20,  timeWindow: '1 minute' };

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure DB tables exist before handling any request
  await initAdminTables();

  // ── Public: invitation response (no auth — protected by token) ──────────────
  fastify.post('/invite/respond', { config: { rateLimit: PUBLIC_LIMIT } }, respondToInviteHandler);

  // ── All other admin routes require authentication ────────────────────────────
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/overview',                    { config: { rateLimit: ADMIN_LIMIT } }, getOverviewHandler);
  fastify.get('/users',                       { config: { rateLimit: ADMIN_LIMIT } }, getUsersHandler);
  fastify.get('/workspaces',                  { config: { rateLimit: ADMIN_LIMIT } }, getWorkspacesHandler);
  fastify.get('/posts',                       { config: { rateLimit: ADMIN_LIMIT } }, getPostsHandler);
  fastify.patch('/posts/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivatePostHandler);
  fastify.patch('/posts/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activatePostHandler);
  fastify.patch('/users/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivateUserHandler);
  fastify.patch('/users/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activateUserHandler);
  fastify.patch('/workspaces/:id/deactivate', { config: { rateLimit: ADMIN_LIMIT } }, deactivateWorkspaceHandler);
  fastify.patch('/workspaces/:id/activate',   { config: { rateLimit: ADMIN_LIMIT } }, activateWorkspaceHandler);

  // ── Admin management: requires superadmin ───────────────────────────────────
  fastify.register(async (superScope) => {
    superScope.addHook('preHandler', requireSuperAdmin);
    superScope.get('/admins',        { config: { rateLimit: ADMIN_LIMIT } }, getAdminsHandler);
    superScope.post('/admins',       { config: { rateLimit: ADMIN_LIMIT } }, addAdminHandler);
    superScope.delete('/admins/:id', { config: { rateLimit: ADMIN_LIMIT } }, removeAdminHandler);
  });
};

export default adminRoutes;
