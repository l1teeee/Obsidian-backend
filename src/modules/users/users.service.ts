import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';

export type UserPlan = 'starter' | 'pro' | 'enterprise';

export interface UserProfile {
  id:                string;
  email:             string;
  name:              string | null;
  role:              string | null;
  country:           string | null;
  avatar_url:        string | null;
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
    'SELECT id, email, name, role, country, avatar_url, plan, is_admin, profile_completed, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const user = rows[0];
  if (!user) throw appError('NOT_FOUND', 'User not found', 404);
  return {
    ...user,
    plan:              (user.plan ?? 'starter') as UserPlan,
    is_admin:          Boolean(user.is_admin),
    profile_completed: Boolean(user.profile_completed),
    avatar_url:        user.avatar_url ?? null,
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

export async function updateProfileSettings(
  userId: string,
  data: { name?: string; role?: string; country?: string },
): Promise<UserProfile> {
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (data.name    !== undefined) { fields.push('name = ?');    values.push(data.name    || null); }
  if (data.role    !== undefined) { fields.push('role = ?');    values.push(data.role    || null); }
  if (data.country !== undefined) { fields.push('country = ?'); values.push(data.country || null); }

  if (fields.length > 0) {
    await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      [...values, userId],
    );
  }

  return getMe(userId);
}

export async function updateAvatar(userId: string, avatarUrl: string): Promise<void> {
  await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
}

export async function updatePlan(userId: string, plan: UserPlan): Promise<void> {
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    throw appError('INVALID_PLAN', 'Invalid plan', 400);
  }
  await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, userId]);
}

// ─── Platform connections (all workspaces) ────────────────────────────────────

export interface PlatformConnectionSummary {
  id:               string;
  platform:         'facebook' | 'instagram';
  account_name:     string;
  account_picture:  string | null;
  token_expires_at: Date | null;
  created_at:       Date;
}

interface PlatformRow extends PlatformConnectionSummary, RowDataPacket {}

export async function getAllPlatforms(userId: string): Promise<PlatformConnectionSummary[]> {
  const [rows] = await pool.query<PlatformRow[]>(
    `SELECT id, platform, account_name, account_picture, token_expires_at, created_at
     FROM social_connections
     WHERE user_id = ? AND is_active = 1
     ORDER BY platform ASC, created_at ASC`,
    [userId],
  );
  return rows;
}

// ─── Activity feed ────────────────────────────────────────────────────────────

export interface ActivityItem {
  action: string;
  detail: string;
  time:   string;
  icon:   string;
  color:  string;
}

interface PostRow extends RowDataPacket {
  caption:    string | null;
  status:     string;
  platform:   string;
  created_at: Date;
}

interface ConnectionRow extends RowDataPacket {
  platform:     string;
  account_name: string;
  updated_at:   Date;
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hrs  < 24)  return `${hrs}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7)   return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function buildActivity(userId: string, postLimit: number, connLimit: number, take: number): Promise<ActivityItem[]> {
  const [posts] = await pool.query<PostRow[]>(
    `SELECT caption, status, platform, created_at
     FROM posts WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ${postLimit}`,
    [userId],
  );

  const [connections] = await pool.query<ConnectionRow[]>(
    `SELECT platform, account_name, updated_at
     FROM social_connections WHERE user_id = ?
     ORDER BY updated_at DESC LIMIT ${connLimit}`,
    [userId],
  );

  type Raw = { action: string; detail: string; ts: Date; icon: string; color: string };
  const raw: Raw[] = [];

  for (const p of posts) {
    const snippet = p.caption
      ? `"${p.caption.slice(0, 50)}${p.caption.length > 50 ? '…' : ''}"`
      : `${p.platform} post`;
    const s = p.status;
    raw.push({
      action: s === 'published' ? 'Published post' : s === 'failed' ? 'Post failed' : s === 'scheduled' ? 'Scheduled post' : 'Draft saved',
      detail: snippet,
      ts:     new Date(p.created_at),
      icon:   s === 'published' ? 'publish' : s === 'failed' ? 'error_outline' : 'schedule',
      color:  s === 'published' ? '#c5d247' : s === 'failed' ? '#ffb4ab' : '#d394ff',
    });
  }

  for (const c of connections) {
    const platform = c.platform.charAt(0).toUpperCase() + c.platform.slice(1);
    raw.push({
      action: 'Connected platform',
      detail: `${platform}: ${c.account_name}`,
      ts:     new Date(c.updated_at),
      icon:   'link',
      color:  '#d394ff',
    });
  }

  raw.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  return raw.slice(0, take).map(({ ts, ...rest }) => ({ ...rest, time: timeAgo(ts) }));
}

export async function getActivity(userId: string): Promise<ActivityItem[]> {
  return buildActivity(userId, 6, 4, 5);
}

export async function getAllActivity(userId: string): Promise<ActivityItem[]> {
  return buildActivity(userId, 40, 20, 50);
}
