import { FastifyRequest, FastifyReply } from 'fastify';
import * as usersService from './users.service';

type CompleteProfileBody = { name: string; role: string; country: string };

export async function getMeHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const profile = await usersService.getMe(request.user.id);
  reply.send({ success: true, data: profile });
}

export async function completeProfileHandler(
  request: FastifyRequest<{ Body: CompleteProfileBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { name, role, country } = request.body;
  await usersService.completeProfile(request.user.id, name, role, country);
  reply.send({ success: true, data: null });
}
