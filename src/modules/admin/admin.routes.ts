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
  getPermissionsHandler,
  setPlanPermissionsHandler,
  getRolesHandler,
  createRoleHandler,
  updateRoleHandler,
  deleteRoleHandler,
  getRoleUsersHandler,
  assignUserToRoleHandler,
  removeUserFromRoleHandler,
} from './admin.controller';
import {
  getTokenStatsHandler,
  getToolBreakdownHandler,
  getTopUsersHandler,
  getTokenLimitsHandler,
  setTokenLimitHandler,
} from './token.controller';
import { initAdminTables } from './admin.service';
import { initTokenTables } from './token.service';

interface AdminRow extends RowDataPacket { is_admin: number; is_superadmin: number }

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const [rows] = await pool.query<AdminRow[]>(
      'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
      [request.user.id],
    );
    if (!rows[0]?.is_admin) {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }
  } catch {
    return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
}

async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const [rows] = await pool.query<AdminRow[]>(
      'SELECT is_superadmin FROM users WHERE id = ? LIMIT 1',
      [request.user.id],
    );
    if (!rows[0]?.is_superadmin) {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Superadmin access required' } });
    }
  } catch {
    return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Superadmin access required' } });
  }
}

const ADMIN_LIMIT  = { max: 120, timeWindow: '1 minute' };
const PUBLIC_LIMIT = { max: 20,  timeWindow: '1 minute' };

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  await initAdminTables();
  await initTokenTables();

  // ── Public: invitation response (protected by token, no auth) ──────────────
  fastify.post('/invite/respond', { config: { rateLimit: PUBLIC_LIMIT } }, respondToInviteHandler);

  // ── Auth required for all routes below ──────────────────────────────────────
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireAdmin);

  // ── Regular admin: Workspaces + Posts only ───────────────────────────────────
  fastify.get('/workspaces',                  { config: { rateLimit: ADMIN_LIMIT } }, getWorkspacesHandler);
  fastify.patch('/workspaces/:id/deactivate', { config: { rateLimit: ADMIN_LIMIT } }, deactivateWorkspaceHandler);
  fastify.patch('/workspaces/:id/activate',   { config: { rateLimit: ADMIN_LIMIT } }, activateWorkspaceHandler);

  fastify.get('/posts',                       { config: { rateLimit: ADMIN_LIMIT } }, getPostsHandler);
  fastify.patch('/posts/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivatePostHandler);
  fastify.patch('/posts/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activatePostHandler);

  // ── Superadmin: Overview + Users + Admins + Permissions + Roles ─────────────
  fastify.register(async (superScope) => {
    superScope.addHook('preHandler', requireSuperAdmin);

    superScope.get('/overview',                    { config: { rateLimit: ADMIN_LIMIT } }, getOverviewHandler);

    superScope.get('/users',                       { config: { rateLimit: ADMIN_LIMIT } }, getUsersHandler);
    superScope.patch('/users/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivateUserHandler);
    superScope.patch('/users/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activateUserHandler);

    superScope.get('/admins',                      { config: { rateLimit: ADMIN_LIMIT } }, getAdminsHandler);
    superScope.post('/admins',                     { config: { rateLimit: ADMIN_LIMIT } }, addAdminHandler);
    superScope.delete('/admins/:id',               { config: { rateLimit: ADMIN_LIMIT } }, removeAdminHandler);

    superScope.get('/permissions',                 { config: { rateLimit: ADMIN_LIMIT } }, getPermissionsHandler);
    superScope.put('/permissions/:plan',           { config: { rateLimit: ADMIN_LIMIT } }, setPlanPermissionsHandler);

    superScope.get('/roles',                             { config: { rateLimit: ADMIN_LIMIT } }, getRolesHandler);
    superScope.post('/roles',                            { config: { rateLimit: ADMIN_LIMIT } }, createRoleHandler);
    superScope.put('/roles/:id',                         { config: { rateLimit: ADMIN_LIMIT } }, updateRoleHandler);
    superScope.delete('/roles/:id',                      { config: { rateLimit: ADMIN_LIMIT } }, deleteRoleHandler);
    superScope.get('/roles/:id/users',                   { config: { rateLimit: ADMIN_LIMIT } }, getRoleUsersHandler);
    superScope.post('/roles/:id/users',                  { config: { rateLimit: ADMIN_LIMIT } }, assignUserToRoleHandler);
    superScope.delete('/roles/:id/users/:userId',        { config: { rateLimit: ADMIN_LIMIT } }, removeUserFromRoleHandler);

    // ── Token usage & limits ────────────────────────────────────────────────
    superScope.get('/tokens/stats',          { config: { rateLimit: ADMIN_LIMIT } }, getTokenStatsHandler);
    superScope.get('/tokens/by-tool',        { config: { rateLimit: ADMIN_LIMIT } }, getToolBreakdownHandler);
    superScope.get('/tokens/top-users',      { config: { rateLimit: ADMIN_LIMIT } }, getTopUsersHandler);
    superScope.get('/tokens/limits',         { config: { rateLimit: ADMIN_LIMIT } }, getTokenLimitsHandler);
    superScope.put('/tokens/limits/:plan',   { config: { rateLimit: ADMIN_LIMIT } }, setTokenLimitHandler);
  });
};

export default adminRoutes;
