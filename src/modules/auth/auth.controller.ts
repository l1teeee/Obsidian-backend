import { FastifyReply, FastifyRequest } from 'fastify';
import * as authService from './auth.service';

type RegisterBody = { email: string; password: string; name: string };
type LoginBody = { email: string; password: string };
type RefreshBody = { refreshToken: string };

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply
): Promise<void> {
  const tokens = await authService.register(
    request.body.email,
    request.body.password,
    request.body.name
  );
  reply.code(201).send({ success: true, data: tokens });
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply
): Promise<void> {
  const tokens = await authService.login(request.body.email, request.body.password);
  reply.send({ success: true, data: tokens });
}

export async function refreshHandler(
  request: FastifyRequest<{ Body: RefreshBody }>,
  reply: FastifyReply
): Promise<void> {
  const tokens = await authService.refresh(request.body.refreshToken);
  reply.send({ success: true, data: tokens });
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await authService.logout(request.user.id);
  reply.send({ success: true, data: null });
}
