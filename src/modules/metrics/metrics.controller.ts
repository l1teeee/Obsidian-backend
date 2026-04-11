import { FastifyRequest, FastifyReply } from 'fastify';
import * as metricsService from './metrics.service';

// ─── GET /dashboard/summary ───────────────────────────────────────────────────

export async function getDashboardSummary(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id: string }).id;
  try {
    const data = await metricsService.getDashboardSummary(userId);
    reply.send({ success: true, data });
  } catch {
    reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard summary' } });
  }
}

// ─── GET /metrics/facebook/posts/:postId ─────────────────────────────────────

export async function getFacebookPostById(
  req: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply,
) {
  const userId = (req.user as { id: string }).id;
  try {
    const data = await metricsService.getFacebookPostById(userId, req.params.postId);
    reply.send({ success: true, data });
  } catch (err) {
    const { status, code, message } = metricsService.classifyGraphError(err);
    reply.code(status).send({ success: false, error: { code, message } });
  }
}

// ─── GET /metrics/facebook/summary ───────────────────────────────────────────

export async function getFacebookSummary(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id: string }).id;

  try {
    const data = await metricsService.getFacebookSummary(userId);
    reply.send({ success: true, data });
  } catch (err) {
    const { status, code, message } = metricsService.classifyGraphError(err);
    reply.code(status).send({ success: false, error: { code, message } });
  }
}

// ─── GET /metrics/facebook/posts ─────────────────────────────────────────────

export async function getFacebookPosts(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id: string }).id;

  try {
    const data = await metricsService.getFacebookPosts(userId);
    reply.send({ success: true, data });
  } catch (err) {
    const { status, code, message } = metricsService.classifyGraphError(err);
    reply.code(status).send({ success: false, error: { code, message } });
  }
}
