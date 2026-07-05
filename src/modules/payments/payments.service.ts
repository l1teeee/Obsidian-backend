import { ResultSetHeader } from 'mysql2';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { PlanName } from '../../config/plans';

interface PaypalTokenResponse {
  access_token: string;
}

interface PaypalSubscriptionResponse {
  status:        string;
  plan_id?:      string;
  billing_info?: { next_billing_time?: string };
}

interface PaypalVerifyResponse {
  verification_status: string;
}

function paypalPlanToTier(paypalPlanId: string): PlanName | null {
  if (!paypalPlanId) return null;
  const map: Record<string, PlanName | undefined> = {
    [env.PAYPAL_PLAN_ID_STARTER]:    'starter',
    [env.PAYPAL_PLAN_ID_PRO]:        'pro',
    [env.PAYPAL_PLAN_ID_ENTERPRISE]: 'enterprise',
  };
  return map[paypalPlanId] ?? null;
}

async function getAccessToken(): Promise<string> {
  const creds = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw Object.assign(new Error('Failed to obtain PayPal access token'), {
      statusCode: 502,
      errorCode:  'PAYPAL_AUTH_FAILED',
    });
  }

  const data = await res.json() as PaypalTokenResponse;
  return data.access_token;
}

export async function confirmSubscription(
  userId:         string,
  subscriptionId: string,
): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(
    `${env.PAYPAL_API_BASE}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  if (!res.ok) {
    throw Object.assign(new Error('Could not verify subscription with PayPal'), {
      statusCode: 422,
      errorCode:  'SUBSCRIPTION_VERIFY_FAILED',
    });
  }

  const sub = await res.json() as PaypalSubscriptionResponse;

  // APPROVAL_PENDING is acceptable: PayPal may not have activated it yet
  if (!['ACTIVE', 'APPROVAL_PENDING'].includes(sub.status)) {
    throw Object.assign(new Error(`Subscription is not active (status: ${sub.status})`), {
      statusCode: 422,
      errorCode:  'SUBSCRIPTION_NOT_ACTIVE',
    });
  }

  // Map the plan_id reported by PayPal — never the one claimed by the client
  const plan = paypalPlanToTier(sub.plan_id ?? '');
  if (!plan) {
    throw Object.assign(new Error('PayPal plan does not match any known tier'), {
      statusCode: 422,
      errorCode:  'UNKNOWN_PAYPAL_PLAN',
    });
  }

  const paidUntil = sub.billing_info?.next_billing_time
    ? new Date(sub.billing_info.next_billing_time)
    : null;

  await pool.query<ResultSetHeader>(
    `UPDATE users
        SET paypal_subscription_id = ?,
            plan                   = ?,
            plan_status            = 'active',
            paid_until             = ?
      WHERE id = ?`,
    [subscriptionId, plan, paidUntil, userId],
  );
}

interface WebhookHeaders {
  transmissionId:   string;
  transmissionTime: string;
  certUrl:          string;
  authAlgo:         string;
  transmissionSig:  string;
}

export async function handleWebhook(
  headers: WebhookHeaders,
  event:   Record<string, unknown>,
): Promise<void> {
  // Verify signature only when PAYPAL_WEBHOOK_ID is configured.
  // Leave it blank during local development to skip verification.
  if (env.PAYPAL_WEBHOOK_ID) {
    const token = await getAccessToken();

    const verifyRes = await fetch(
      `${env.PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transmission_id:   headers.transmissionId,
          transmission_time: headers.transmissionTime,
          cert_url:          headers.certUrl,
          auth_algo:         headers.authAlgo,
          transmission_sig:  headers.transmissionSig,
          webhook_id:        env.PAYPAL_WEBHOOK_ID,
          webhook_event:     event,
        }),
      },
    );

    if (!verifyRes.ok) {
      throw Object.assign(new Error('PayPal signature verification request failed'), {
        statusCode: 401,
        errorCode:  'INVALID_SIGNATURE',
      });
    }

    const result = await verifyRes.json() as PaypalVerifyResponse;
    if (result.verification_status !== 'SUCCESS') {
      throw Object.assign(new Error('Invalid webhook signature'), {
        statusCode: 401,
        errorCode:  'INVALID_SIGNATURE',
      });
    }
  }

  const eventType = (event['event_type'] as string) ?? '';
  const resource  = (event['resource']   as Record<string, unknown>) ?? {};
  const subId     = resource['id'] as string | undefined;

  if (!subId) return;

  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const billing = resource['billing_info'] as { next_billing_time?: string } | undefined;
      const plan    = paypalPlanToTier((resource['plan_id'] as string) ?? '');
      await pool.query<ResultSetHeader>(
        `UPDATE users
            SET plan_status = 'active',
                plan        = COALESCE(?, plan),
                paid_until  = COALESCE(?, paid_until)
          WHERE paypal_subscription_id = ?`,
        [plan, billing?.next_billing_time ? new Date(billing.next_billing_time) : null, subId],
      );
      break;
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      // Access continues until the end of the already-paid period (paid_until)
      const billing = resource['billing_info'] as { next_billing_time?: string } | undefined;
      await pool.query<ResultSetHeader>(
        `UPDATE users
            SET plan_status = 'cancelled',
                paid_until  = COALESCE(?, paid_until)
          WHERE paypal_subscription_id = ?`,
        [billing?.next_billing_time ? new Date(billing.next_billing_time) : null, subId],
      );
      break;
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED':
      await pool.query<ResultSetHeader>(
        `UPDATE users SET plan_status = 'expired', plan = NULL WHERE paypal_subscription_id = ?`,
        [subId],
      );
      break;

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      await pool.query<ResultSetHeader>(
        `UPDATE users SET plan_status = 'suspended' WHERE paypal_subscription_id = ?`,
        [subId],
      );
      break;

    default:
      // Unhandled event type — acknowledge receipt, take no action
      break;
  }
}
