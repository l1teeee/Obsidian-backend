import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import {
  deriveSubscriptionState,
  SubscriptionFields,
  SubscriptionState,
} from './subscription-state';
import { PLANS, PlanName } from '../../config/plans';

interface StateRow extends RowDataPacket, SubscriptionFields {}

export async function getSubscriptionState(userId: string): Promise<SubscriptionState> {
  const [rows] = await pool.query<StateRow[]>(
    'SELECT plan, plan_status, trial_ends_at, paid_until, is_admin FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error('User not found'), {
      statusCode: 404,
      errorCode:  'USER_NOT_FOUND',
    });
  }
  return deriveSubscriptionState(rows[0]);
}

interface CountRow extends RowDataPacket { n: number }

async function requireEffectivePlan(userId: string): Promise<PlanName> {
  const state = await getSubscriptionState(userId);
  if (!state.effectivePlan) {
    throw Object.assign(
      new Error('Your free trial has ended. An active subscription is required.'),
      { statusCode: 402, errorCode: 'SUBSCRIPTION_REQUIRED' },
    );
  }
  return state.effectivePlan;
}

export async function assertConnectionLimit(userId: string): Promise<void> {
  const plan  = await requireEffectivePlan(userId);
  const limit = PLANS[plan].maxConnections;
  if (limit === null) return; // unlimited

  const [rows] = await pool.query<CountRow[]>(
    'SELECT COUNT(*) AS n FROM social_connections WHERE user_id = ? AND is_active = 1',
    [userId],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw Object.assign(
      new Error(`Your plan allows up to ${limit} connected social accounts`),
      { statusCode: 403, errorCode: 'PLAN_LIMIT_REACHED' },
    );
  }
}

export async function assertMonthlyPostLimit(userId: string): Promise<void> {
  const plan  = await requireEffectivePlan(userId);
  const limit = PLANS[plan].postsPerMonth;
  if (limit === null) return; // unlimited

  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n
       FROM posts
      WHERE user_id = ?
        AND status <> 'draft'
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [userId],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw Object.assign(
      new Error(`Your plan allows up to ${limit} scheduled or published posts per month`),
      { statusCode: 403, errorCode: 'PLAN_LIMIT_REACHED' },
    );
  }
}
