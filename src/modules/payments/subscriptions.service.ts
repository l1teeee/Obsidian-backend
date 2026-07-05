import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import {
  deriveSubscriptionState,
  SubscriptionFields,
  SubscriptionState,
} from './subscription-state';

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
