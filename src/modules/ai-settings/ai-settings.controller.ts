import { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './ai-settings.service';

interface Params { workspaceId: string }
interface UpsertBody {
  persona?:             string;
  brand_voice?:         string;
  target_audience?:     string;
  content_pillars?:     string;
  hashtag_strategy?:    string;
  example_posts?:       string;
  avoid?:               string;
  custom_instructions?: string;
}

export async function getHandler(
  request: FastifyRequest<{ Params: Params }>,
  reply:   FastifyReply,
): Promise<void> {
  const userId      = request.user.id;
  const workspaceId = request.params.workspaceId;
  const settings    = await service.getByWorkspace(workspaceId, userId);
  reply.code(200).send({ success: true, data: settings ?? {} });
}

export async function upsertHandler(
  request: FastifyRequest<{ Params: Params; Body: UpsertBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const userId      = request.user.id;
  const workspaceId = request.params.workspaceId;
  const settings    = await service.upsert(workspaceId, userId, request.body);
  reply.code(200).send({ success: true, data: settings });
}
