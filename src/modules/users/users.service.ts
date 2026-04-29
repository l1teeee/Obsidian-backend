import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';

export type UserPlan = 'starter' | 'pro' | 'enterprise';

export interface UserProfile {
  id:                string;
  email:             string;
  name:              string | null;
  role:              string | null;
  country:           string | null;
  plan:              UserPlan;
  is_admin:          boolean;
  profile_completed: boolean;
  created_at:        Date;
}

interface UserRow extends UserProfile, RowDataPacket {}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

export async function getMe(userId: string): Promise<UserProfile> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, name, role, country, plan, is_admin, profile_completed, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const user = rows[0];
  if (!user) throw appError('NOT_FOUND', 'User not found', 404);
  return {
    ...user,
    plan:              (user.plan ?? 'starter') as UserPlan,
    is_admin:          Boolean(user.is_admin),
    profile_completed: Boolean(user.profile_completed),
  };
}

export async function completeProfile(
  userId:  string,
  name:    string,
  role:    string,
  country: string,
): Promise<void> {
  await pool.query(
    'UPDATE users SET name = ?, role = ?, country = ?, profile_completed = 1, first_login = 0 WHERE id = ?',
    [name, role, country, userId],
  );
}
