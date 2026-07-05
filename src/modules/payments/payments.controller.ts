import { FastifyReply, FastifyRequest } from 'fastify';
import * as paymentsService from './payments.service';
import { getSubscriptionState } from './subscriptions.service';
import { PLANS } from '../../config/plans';

type ConfirmSubscriptionBody = {
  subscriptionId: string;
};

export async function confirmSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  const body   = request.body as ConfirmSubscriptionBody;
  await paymentsService.confirmSubscription(userId, body.subscriptionId);
  reply.send({ success: true, data: null });
}

export async function getSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  const state  = await getSubscriptionState(userId);
  const limits = state.effectivePlan
    ? {
        connections:      PLANS[state.effectivePlan].maxConnections,
        postsPerMonth:    PLANS[state.effectivePlan].postsPerMonth,
        aiTokensPerMonth: PLANS[state.effectivePlan].aiTokensPerMonth,
        sessions:         PLANS[state.effectivePlan].maxSessions,
      }
    : null;

  reply.send({
    success: true,
    data: {
      status:        state.status,
      plan:          state.plan,
      effectivePlan: state.effectivePlan,
      trialEndsAt:   state.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft: state.trialDaysLeft,
      paidUntil:     state.paidUntil?.toISOString() ?? null,
      limits,
    },
  });
}

export async function cancelSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  await paymentsService.cancelSubscription(userId);
  reply.send({ success: true, data: null });
}

export async function webhookHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const headers = {
    transmissionId:   (request.headers['paypal-transmission-id']   as string) ?? '',
    transmissionTime: (request.headers['paypal-transmission-time'] as string) ?? '',
    certUrl:          (request.headers['paypal-cert-url']          as string) ?? '',
    authAlgo:         (request.headers['paypal-auth-algo']         as string) ?? '',
    transmissionSig:  (request.headers['paypal-transmission-sig']  as string) ?? '',
  };

  try {
    await paymentsService.handleWebhook(headers, request.body as Record<string, unknown>);
    reply.code(200).send({ success: true });
  } catch (err) {
    const e = err as Error & { statusCode?: number; errorCode?: string };
    if (e.statusCode === 401) {
      return reply.code(401).send({
        success: false,
        error: { code: e.errorCode ?? 'INVALID_SIGNATURE', message: e.message },
      });
    }
    // Re-throw other errors so PayPal retries delivery (500 response)
    throw err;
  }
}
