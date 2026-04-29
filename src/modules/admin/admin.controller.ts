import { FastifyRequest, FastifyReply } from 'fastify';
import * as adminService from './admin.service';

type IdParams        = { id: string };
type PostParams      = IdParams;
type PostActionBody  = { reason?: string };
type UsersQuery      = { page?: string; limit?: string; search?: string; plan?: string };
type WorkspacesQuery = { page?: string; limit?: string; search?: string };
type PostsQuery      = { page?: string; limit?: string; platform?: string; status?: string; search?: string };

function page(v?: string)  { return Math.max(1, parseInt(v ?? '1', 10) || 1); }
function limit(v?: string) { return Math.min(100, Math.max(1, parseInt(v ?? '50', 10) || 50)); }

export async function deactivatePostHandler(
  request: FastifyRequest<{ Params: PostParams; Body: PostActionBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const reason = request.body?.reason?.trim() || 'No reason provided';
  await adminService.deactivatePost(request.params.id, reason);
  reply.send({ success: true, data: null });
}

export async function activatePostHandler(
  request: FastifyRequest<{ Params: PostParams; Body: PostActionBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const reason = request.body?.reason?.trim() || 'No reason provided';
  await adminService.activatePost(request.params.id, reason);
  reply.send({ success: true, data: null });
}

export async function deactivateUserHandler(
  request: FastifyRequest<{ Params: IdParams; Body: PostActionBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const reason = request.body?.reason?.trim() || 'No reason provided';
  await adminService.deactivateUser(request.params.id, reason);
  reply.send({ success: true, data: null });
}

export async function activateUserHandler(
  request: FastifyRequest<{ Params: IdParams; Body: PostActionBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const reason = request.body?.reason?.trim() || 'No reason provided';
  await adminService.activateUser(request.params.id, reason);
  reply.send({ success: true, data: null });
}

export async function deactivateWorkspaceHandler(
  request: FastifyRequest<{ Params: IdParams }>,
  reply:   FastifyReply,
): Promise<void> {
  await adminService.deactivateWorkspace(request.params.id);
  reply.send({ success: true, data: null });
}

export async function activateWorkspaceHandler(
  request: FastifyRequest<{ Params: IdParams }>,
  reply:   FastifyReply,
): Promise<void> {
  await adminService.activateWorkspace(request.params.id);
  reply.send({ success: true, data: null });
}

export async function getOverviewHandler(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await adminService.getOverview();
  reply.send({ success: true, data });
}

export async function getUsersHandler(
  request: FastifyRequest<{ Querystring: UsersQuery }>,
  reply:   FastifyReply,
): Promise<void> {
  const { search, plan } = request.query;
  const result = await adminService.getUsers({
    page:   page(request.query.page),
    limit:  limit(request.query.limit),
    search: search || undefined,
    plan:   plan   || undefined,
  });
  reply.send({ success: true, data: result.users, meta: result.meta });
}

export async function getWorkspacesHandler(
  request: FastifyRequest<{ Querystring: WorkspacesQuery }>,
  reply:   FastifyReply,
): Promise<void> {
  const { search } = request.query;
  const result = await adminService.getWorkspaces({
    page:   page(request.query.page),
    limit:  limit(request.query.limit),
    search: search || undefined,
  });
  reply.send({ success: true, data: result.workspaces, meta: result.meta });
}

export async function getPostsHandler(
  request: FastifyRequest<{ Querystring: PostsQuery }>,
  reply:   FastifyReply,
): Promise<void> {
  const { platform, status, search } = request.query;
  const result = await adminService.getPosts({
    page:     page(request.query.page),
    limit:    limit(request.query.limit),
    platform: platform || undefined,
    status:   status   || undefined,
    search:   search   || undefined,
  });
  reply.send({ success: true, data: result.posts, meta: result.meta });
}
