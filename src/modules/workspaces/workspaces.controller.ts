import { FastifyReply, FastifyRequest } from 'fastify';
import * as service from './workspaces.service';

type CreateBody = { name: string };
type UpdateBody = { name: string };
type IdParams   = { id: string };

export async function listHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const workspaces = await service.getWorkspaces(request.user.id);
  reply.send({ success: true, data: workspaces });
}

export async function createHandler(
  request: FastifyRequest<{ Body: CreateBody }>,
  reply: FastifyReply
): Promise<void> {
  const workspace = await service.createWorkspace(request.user.id, request.body.name);
  reply.code(201).send({ success: true, data: workspace });
}

export async function updateHandler(
  request: FastifyRequest<{ Body: UpdateBody; Params: IdParams }>,
  reply: FastifyReply
): Promise<void> {
  const workspace = await service.updateWorkspace(
    request.params.id,
    request.user.id,
    request.body.name
  );
  reply.send({ success: true, data: workspace });
}

export async function deleteHandler(
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply
): Promise<void> {
  await service.deleteWorkspace(request.params.id, request.user.id);
  reply.send({ success: true, data: null });
}
