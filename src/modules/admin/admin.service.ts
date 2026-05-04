import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { sendPostStatusChangedEmail, sendAccountStatusChangedEmail, sendAdminInviteEmail } from '../../lib/email';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  total_users:      number;
  total_workspaces: number;
  total_posts:      number;
  posts_this_week:  number;
  users_this_week:  number;
}

export interface AdminWeekPoint {
  week:  string;
  count: number;
}

export interface AdminUserRow {
  id:                string;
  email:             string;
  name:              string | null;
  role:              string | null;
  plan:              string;
  is_admin:          boolean;
  is_banned:         boolean;
  profile_completed: boolean;
  created_at:        Date;
  workspace_count:   number;
  post_count:        number;
}

export interface AdminWorkspaceRow {
  id:           string;
  name:         string;
  user_id:      string;
  owner_email:  string;
  owner_name:   string | null;
  post_count:   number;
  is_active:    boolean;
  created_at:   Date;
}

export interface AdminPostRow {
  id:             string;
  user_id:        string;
  owner_email:    string;
  workspace_id:   string;
  workspace_name: string;
  platform:       string;
  post_type:      string;
  caption:        string | null;
  status:         string;
  scheduled_at:   Date | null;
  published_at:   Date | null;
  created_at:     Date;
}

export interface AdminOverview {
  stats:          AdminStats;
  posts_by_week:  AdminWeekPoint[];
  users_by_week:  AdminWeekPoint[];
  top_workspaces: AdminWorkspaceRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StatsRow extends RowDataPacket {
  total_users:      number;
  total_workspaces: number;
  total_posts:      number;
  posts_this_week:  number;
  users_this_week:  number;
}

interface WeekRow extends RowDataPacket {
  week:  string;
  count: number;
}

interface TopWsRow extends RowDataPacket {
  id:          string;
  name:        string;
  user_id:     string;
  owner_email: string;
  owner_name:  string | null;
  post_count:  number;
  is_active:   number;
  created_at:  Date;
}

interface UserRow extends RowDataPacket {
  id:                string;
  email:             string;
  name:              string | null;
  role:              string | null;
  plan:              string;
  is_admin:          number;
  is_banned:         number;
  profile_completed: number;
  created_at:        Date;
  workspace_count:   number;
  post_count:        number;
}

interface WsRow extends RowDataPacket {
  id:          string;
  name:        string;
  user_id:     string;
  owner_email: string;
  owner_name:  string | null;
  post_count:  number;
  is_active:   number;
  created_at:  Date;
}

interface PostRow extends RowDataPacket {
  id:             string;
  user_id:        string;
  owner_email:    string;
  workspace_id:   string | null;
  workspace_name: string | null;
  platform:       string;
  post_type:      string;
  caption:        string | null;
  status:         string;
  scheduled_at:   Date | null;
  published_at:   Date | null;
  created_at:     Date;
}

interface CountRow extends RowDataPacket { total: number }

// ─── Service functions ────────────────────────────────────────────────────────

export async function getOverview(): Promise<AdminOverview> {
  const [[stats]] = await pool.query<StatsRow[]>(`
    SELECT
      (SELECT COUNT(*) FROM users)                                                             AS total_users,
      (SELECT COUNT(*) FROM workspaces)                                                        AS total_workspaces,
      (SELECT COUNT(*) FROM posts WHERE status != 'deleted')                                   AS total_posts,
      (SELECT COUNT(*) FROM posts WHERE status != 'deleted'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))                                   AS posts_this_week,
      (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))        AS users_this_week
  `);

  const [postsWeekRows] = await pool.query<WeekRow[]>(`
    SELECT
      DATE_FORMAT(created_at - INTERVAL WEEKDAY(created_at) DAY, '%Y-%m-%d') AS week,
      COUNT(*) AS count
    FROM posts
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      AND status != 'deleted'
    GROUP BY week
    ORDER BY week ASC
  `);

  const [usersWeekRows] = await pool.query<WeekRow[]>(`
    SELECT
      DATE_FORMAT(created_at - INTERVAL WEEKDAY(created_at) DAY, '%Y-%m-%d') AS week,
      COUNT(*) AS count
    FROM users
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
    GROUP BY week
    ORDER BY week ASC
  `);

  // Top workspaces: per user, using their first workspace as display name.
  // Posts have no workspace_id — they're user-scoped.
  const [topRows] = await pool.query<TopWsRow[]>(`
    SELECT
      MIN(w.id)                        AS id,
      MIN(w.name)                      AS name,
      u.id                             AS user_id,
      u.email                          AS owner_email,
      u.name                           AS owner_name,
      COUNT(DISTINCT p.id)             AS post_count,
      COALESCE(MIN(w.is_active), 1)    AS is_active,
      MIN(w.created_at)                AS created_at
    FROM users u
    LEFT JOIN workspaces w ON w.user_id = u.id
    LEFT JOIN posts p ON p.user_id = u.id AND p.status != 'deleted'
    GROUP BY u.id
    ORDER BY post_count DESC
    LIMIT 10
  `);

  return {
    stats: {
      total_users:      Number(stats.total_users),
      total_workspaces: Number(stats.total_workspaces),
      total_posts:      Number(stats.total_posts),
      posts_this_week:  Number(stats.posts_this_week),
      users_this_week:  Number(stats.users_this_week),
    },
    posts_by_week:  postsWeekRows.map(r => ({ week: r.week, count: Number(r.count) })),
    users_by_week:  usersWeekRows.map(r => ({ week: r.week, count: Number(r.count) })),
    top_workspaces: topRows.map(r => ({
      id:          r.id ?? '',
      name:        r.name ?? '(no workspace)',
      user_id:     r.user_id,
      owner_email: r.owner_email,
      owner_name:  r.owner_name,
      post_count:  Number(r.post_count),
      is_active:   Boolean(r.is_active),
      created_at:  r.created_at,
    })),
  };
}

export async function getUsers(params: {
  page:    number;
  limit:   number;
  search?: string;
  plan?:   string;
}): Promise<{ users: AdminUserRow[]; meta: { page: number; limit: number; total: number } }> {
  const { page, limit, search, plan } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const args: unknown[]      = [];

  if (search) {
    conditions.push('(u.email LIKE ? OR u.name LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like);
  }
  if (plan) {
    conditions.push('u.plan = ?');
    args.push(plan);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query<CountRow[]>(
    `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${where}`,
    args,
  );

  const [rows] = await pool.query<UserRow[]>(
    `SELECT
       u.id, u.email, u.name, u.role, u.plan, u.is_admin, u.is_banned, u.profile_completed, u.created_at,
       COUNT(DISTINCT w.id) AS workspace_count,
       COUNT(DISTINCT p.id) AS post_count
     FROM users u
     LEFT JOIN workspaces w ON w.user_id = u.id
     LEFT JOIN posts p ON p.user_id = u.id AND p.status != 'deleted'
     ${where}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );

  return {
    users: rows.map(r => ({
      id:                r.id,
      email:             r.email,
      name:              r.name,
      role:              r.role,
      plan:              r.plan ?? 'starter',
      is_admin:          Boolean(r.is_admin),
      is_banned:         Boolean(r.is_banned),
      profile_completed: Boolean(r.profile_completed),
      created_at:        r.created_at,
      workspace_count:   Number(r.workspace_count),
      post_count:        Number(r.post_count),
    })),
    meta: { page, limit, total: Number(total) },
  };
}

export async function getWorkspaces(params: {
  page:    number;
  limit:   number;
  search?: string;
}): Promise<{ workspaces: AdminWorkspaceRow[]; meta: { page: number; limit: number; total: number } }> {
  const { page, limit, search } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const args: unknown[]      = [];

  if (search) {
    conditions.push('(w.name LIKE ? OR u.email LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query<CountRow[]>(
    `SELECT COUNT(DISTINCT w.id) AS total
     FROM workspaces w JOIN users u ON u.id = w.user_id ${where}`,
    args,
  );

  const [rows] = await pool.query<WsRow[]>(
    `SELECT
       w.id, w.name, w.user_id, w.is_active, w.created_at,
       u.email AS owner_email, u.name AS owner_name,
       COUNT(DISTINCT p.id) AS post_count
     FROM workspaces w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN posts p ON p.user_id = w.user_id AND p.status != 'deleted'
     ${where}
     GROUP BY w.id
     ORDER BY w.created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );

  return {
    workspaces: rows.map(r => ({
      id:          r.id,
      name:        r.name,
      user_id:     r.user_id,
      owner_email: r.owner_email,
      owner_name:  r.owner_name,
      post_count:  Number(r.post_count),
      is_active:   Boolean(r.is_active),
      created_at:  r.created_at,
    })),
    meta: { page, limit, total: Number(total) },
  };
}

interface PostUserRow extends RowDataPacket {
  id:           string;
  status:       string;
  platform:     string;
  post_type:    string;
  caption:      string | null;
  scheduled_at: Date | null;
  published_at: Date | null;
  created_at:   Date;
  email:        string;
  name:         string | null;
}

async function getPostWithUser(postId: string): Promise<PostUserRow> {
  const [[row]] = await pool.query<PostUserRow[]>(
    `SELECT p.id, p.status, p.platform, p.post_type, p.caption,
            p.scheduled_at, p.published_at, p.created_at, u.email, u.name
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.status != 'deleted' LIMIT 1`,
    [postId],
  );
  if (!row) throw Object.assign(new Error('Post not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  return row;
}

export async function deactivatePost(postId: string, reason: string): Promise<void> {
  const post = await getPostWithUser(postId);
  if (post.status === 'inactive') return;

  await pool.query("UPDATE posts SET status = 'inactive' WHERE id = ?", [postId]);

  sendPostStatusChangedEmail(post.email, {
    name:         post.name ?? undefined,
    platform:     post.platform,
    post_type:    post.post_type,
    action:       'deactivated',
    reason,
    caption:      post.caption ?? undefined,
    scheduled_at: post.scheduled_at?.toISOString(),
    published_at: post.published_at?.toISOString(),
    created_at:   post.created_at.toISOString(),
    postId,
  });
}

export async function activatePost(postId: string, reason: string): Promise<void> {
  const post = await getPostWithUser(postId);
  if (post.status !== 'inactive') return;

  await pool.query("UPDATE posts SET status = 'draft' WHERE id = ?", [postId]);

  sendPostStatusChangedEmail(post.email, {
    name:         post.name ?? undefined,
    platform:     post.platform,
    post_type:    post.post_type,
    action:       'activated',
    reason,
    caption:      post.caption ?? undefined,
    scheduled_at: post.scheduled_at?.toISOString(),
    published_at: post.published_at?.toISOString(),
    created_at:   post.created_at.toISOString(),
    postId,
  });
}

export async function getPosts(params: {
  page:      number;
  limit:     number;
  platform?: string;
  status?:   string;
  search?:   string;
}): Promise<{ posts: AdminPostRow[]; meta: { page: number; limit: number; total: number } }> {
  const { page, limit, platform, status, search } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ["p.status != 'deleted'"];
  const args: unknown[]      = [];

  if (platform) { conditions.push('p.platform = ?'); args.push(platform); }
  if (status)   { conditions.push('p.status = ?');   args.push(status);   }
  if (search) {
    conditions.push('(p.caption LIKE ? OR u.email LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [[{ total }]] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.user_id ${where}`,
    args,
  );

  const [rows] = await pool.query<PostRow[]>(
    `SELECT
       p.id, p.user_id, p.platform, p.post_type, p.caption, p.status,
       p.scheduled_at, p.published_at, p.created_at,
       u.email AS owner_email,
       (SELECT id   FROM workspaces WHERE user_id = p.user_id ORDER BY created_at ASC LIMIT 1) AS workspace_id,
       (SELECT name FROM workspaces WHERE user_id = p.user_id ORDER BY created_at ASC LIMIT 1) AS workspace_name
     FROM posts p
     JOIN users u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );

  return {
    posts: rows.map(r => ({
      id:             r.id,
      user_id:        r.user_id,
      owner_email:    r.owner_email,
      workspace_id:   r.workspace_id ?? '',
      workspace_name: r.workspace_name ?? 'No workspace',
      platform:       r.platform,
      post_type:      r.post_type,
      caption:        r.caption,
      status:         r.status,
      scheduled_at:   r.scheduled_at,
      published_at:   r.published_at,
      created_at:     r.created_at,
    })),
    meta: { page, limit, total: Number(total) },
  };
}

// ─── Admins ───────────────────────────────────────────────────────────────────

export interface AdminEntry {
  id:         string;
  email:      string;
  name:       string | null;
  created_at: Date;
  added_by:   string | null;
}

interface AdminEntryRow extends RowDataPacket {
  id:         string;
  email:      string;
  name:       string | null;
  created_at: Date;
  added_by:   string | null;
}

interface AdminCheckRow extends RowDataPacket {
  id:       string;
  email:    string;
  name:     string | null;
  is_admin: number;
}

export async function getAdmins(): Promise<AdminEntry[]> {
  const [rows] = await pool.query<AdminEntryRow[]>(
    `SELECT id, email, name, created_at, NULL AS added_by
     FROM users WHERE is_admin = 1 ORDER BY created_at ASC`,
  );
  return rows.map(r => ({
    id:         r.id,
    email:      r.email,
    name:       r.name,
    created_at: r.created_at,
    added_by:   r.added_by,
  }));
}

export async function addAdmin(email: string, addedByName: string | null): Promise<AdminEntry> {
  const [[row]] = await pool.query<AdminCheckRow[]>(
    'SELECT id, email, name, is_admin FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  if (!row) throw Object.assign(new Error('No user found with that email'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (row.is_admin) throw Object.assign(new Error('User is already an admin'), { errorCode: 'CONFLICT', statusCode: 409 });

  await pool.query('UPDATE users SET is_admin = 1 WHERE id = ?', [row.id]);

  sendAdminInviteEmail(row.email, {
    name:     row.name ?? undefined,
    addedBy:  addedByName ?? undefined,
  });

  const [[updated]] = await pool.query<AdminEntryRow[]>(
    'SELECT id, email, name, created_at, NULL AS added_by FROM users WHERE id = ? LIMIT 1',
    [row.id],
  );
  return {
    id:         updated.id,
    email:      updated.email,
    name:       updated.name,
    created_at: updated.created_at,
    added_by:   addedByName,
  };
}

export async function removeAdmin(targetId: string, requesterId: string): Promise<void> {
  if (targetId === requesterId) {
    throw Object.assign(new Error('You cannot remove your own admin access'), { errorCode: 'FORBIDDEN', statusCode: 403 });
  }
  const [[row]] = await pool.query<AdminCheckRow[]>(
    'SELECT id, is_admin FROM users WHERE id = ? LIMIT 1',
    [targetId],
  );
  if (!row) throw Object.assign(new Error('User not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (!row.is_admin) throw Object.assign(new Error('User is not an admin'), { errorCode: 'CONFLICT', statusCode: 409 });

  await pool.query('UPDATE users SET is_admin = 0 WHERE id = ?', [targetId]);
}

// ─── User activate / deactivate ───────────────────────────────────────────────

interface UserBanRow extends RowDataPacket { email: string; name: string | null; is_banned: number }

export async function deactivateUser(userId: string, reason: string): Promise<void> {
  const [[row]] = await pool.query<UserBanRow[]>(
    'SELECT email, name, is_banned FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!row) throw Object.assign(new Error('User not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (row.is_banned) return;

  await pool.query('UPDATE users SET is_banned = 1 WHERE id = ?', [userId]);
  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [userId]);

  sendAccountStatusChangedEmail(row.email, { name: row.name ?? undefined, action: 'deactivated', reason });
}

export async function activateUser(userId: string, reason: string): Promise<void> {
  const [[row]] = await pool.query<UserBanRow[]>(
    'SELECT email, name, is_banned FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!row) throw Object.assign(new Error('User not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (!row.is_banned) return;

  await pool.query('UPDATE users SET is_banned = 0 WHERE id = ?', [userId]);

  sendAccountStatusChangedEmail(row.email, { name: row.name ?? undefined, action: 'activated', reason });
}

// ─── Workspace activate / deactivate ─────────────────────────────────────────

interface WsBanRow extends RowDataPacket { id: string; is_active: number }

export async function deactivateWorkspace(wsId: string): Promise<void> {
  const [[row]] = await pool.query<WsBanRow[]>(
    'SELECT id, is_active FROM workspaces WHERE id = ? LIMIT 1',
    [wsId],
  );
  if (!row) throw Object.assign(new Error('Workspace not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (!row.is_active) return;

  await pool.query('UPDATE workspaces SET is_active = 0 WHERE id = ?', [wsId]);
}

export async function activateWorkspace(wsId: string): Promise<void> {
  const [[row]] = await pool.query<WsBanRow[]>(
    'SELECT id, is_active FROM workspaces WHERE id = ? LIMIT 1',
    [wsId],
  );
  if (!row) throw Object.assign(new Error('Workspace not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (row.is_active) return;

  await pool.query('UPDATE workspaces SET is_active = 1 WHERE id = ?', [wsId]);
}
