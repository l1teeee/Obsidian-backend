import { FastifyRequest, FastifyReply } from 'fastify';
import * as usersService from './users.service';
import { sendProfileUpdatedEmail } from '../../lib/email';

type CompleteProfileBody   = { name: string; role: string; country: string };
type UpdateProfileBody     = { name?: string; role?: string; country?: string };
type UpdatePlanBody        = { plan: usersService.UserPlan };
type UpdateAvatarBody      = { avatar_url: string };

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

export async function updateProfileHandler(
  request: FastifyRequest<{ Body: UpdateProfileBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const profile = await usersService.updateProfileSettings(request.user.id, request.body);
  const updatedFields = Object.keys(request.body).filter(k => (request.body as Record<string, unknown>)[k] !== undefined);
  if (updatedFields.length > 0) {
    void sendProfileUpdatedEmail(profile.email, { name: profile.name ?? undefined, updatedFields });
  }
  reply.send({ success: true, data: profile });
}

export async function updatePlanHandler(
  request: FastifyRequest<{ Body: UpdatePlanBody }>,
  reply:   FastifyReply,
): Promise<void> {
  await usersService.updatePlan(request.user.id, request.body.plan);
  reply.send({ success: true, data: null });
}

export async function getPlatformsHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const platforms = await usersService.getAllPlatforms(request.user.id);
  reply.send({ success: true, data: platforms });
}

export async function getActivityHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const activity = await usersService.getActivity(request.user.id);
  reply.send({ success: true, data: activity });
}

export async function getAllActivityHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const activity = await usersService.getAllActivity(request.user.id);
  reply.send({ success: true, data: activity });
}

export async function updateAvatarHandler(
  request: FastifyRequest<{ Body: UpdateAvatarBody }>,
  reply:   FastifyReply,
): Promise<void> {
  await usersService.updateAvatar(request.user.id, request.body.avatar_url);
  const profile = await usersService.getMe(request.user.id);
  void sendProfileUpdatedEmail(profile.email, { name: profile.name ?? undefined, updatedFields: ['avatar_url'] });
  reply.send({ success: true, data: { avatar_url: profile.avatar_url } });
}
