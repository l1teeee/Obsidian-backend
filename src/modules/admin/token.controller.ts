import { FastifyRequest, FastifyReply } from 'fastify';
import * as tokenService from './token.service';

type PeriodQuery = { period?: string };
type PlanParams  = { plan: string };
type LimitBody   = { monthly_limit: number };

export async function getTokenStatsHandler(
  request: FastifyRequest<{ Querystring: PeriodQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const stats = await tokenService.getTokenStats(request.query.period ?? '30d');
  reply.send({ success: true, data: stats });
}

export async function getToolBreakdownHandler(
  request: FastifyRequest<{ Querystring: PeriodQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const data = await tokenService.getToolBreakdown(request.query.period ?? '30d');
  reply.send({ success: true, data });
}

export async function getTopUsersHandler(
  request: FastifyRequest<{ Querystring: PeriodQuery & { limit?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const limit = Math.min(50, Number(request.query.limit ?? 10));
  const data  = await tokenService.getTopUsers(request.query.period ?? '30d', limit);
  reply.send({ success: true, data });
}

export async function getTokenLimitsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await tokenService.getTokenLimits();
  reply.send({ success: true, data });
}

export async function setTokenLimitHandler(
  request: FastifyRequest<{ Params: PlanParams; Body: LimitBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { plan } = request.params;
  if (!['free', 'starter', 'pro', 'enterprise'].includes(plan)) {
    return reply.code(400).send({ success: false, error: { code: 'INVALID_PLAN', message: 'Invalid plan' } });
  }
  const limit = Number(request.body?.monthly_limit);
  if (isNaN(limit) || limit < 0) {
    return reply.code(400).send({ success: false, error: { code: 'INVALID_LIMIT', message: 'monthly_limit must be >= 0' } });
  }
  await tokenService.setTokenLimit(plan, Math.floor(limit));
  reply.send({ success: true, data: null });
}
