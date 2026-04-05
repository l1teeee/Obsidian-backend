import { FastifyRequest, FastifyReply } from 'fastify';
import * as metricsService from './metrics.service';

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
