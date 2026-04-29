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
} from './admin.controller';

interface AdminRow extends RowDataPacket { is_admin: number }

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = request.user.id;
  const [rows] = await pool.query<AdminRow[]>(
    'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!rows[0] || !rows[0].is_admin) {
    reply.code(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
}

const ADMIN_LIMIT = { max: 120, timeWindow: '1 minute' };

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/overview',              { config: { rateLimit: ADMIN_LIMIT } }, getOverviewHandler);
  fastify.get('/users',                 { config: { rateLimit: ADMIN_LIMIT } }, getUsersHandler);
  fastify.get('/workspaces',            { config: { rateLimit: ADMIN_LIMIT } }, getWorkspacesHandler);
  fastify.get('/posts',                 { config: { rateLimit: ADMIN_LIMIT } }, getPostsHandler);
  fastify.patch('/posts/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivatePostHandler);
  fastify.patch('/posts/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activatePostHandler);
  fastify.patch('/users/:id/deactivate',      { config: { rateLimit: ADMIN_LIMIT } }, deactivateUserHandler);
  fastify.patch('/users/:id/activate',        { config: { rateLimit: ADMIN_LIMIT } }, activateUserHandler);
  fastify.patch('/workspaces/:id/deactivate', { config: { rateLimit: ADMIN_LIMIT } }, deactivateWorkspaceHandler);
  fastify.patch('/workspaces/:id/activate',   { config: { rateLimit: ADMIN_LIMIT } }, activateWorkspaceHandler);
};

export default adminRoutes;
