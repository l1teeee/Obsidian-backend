import { randomBytes } from 'crypto';
import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { sendPostStatusChangedEmail, sendAccountStatusChangedEmail, sendAdminInviteEmail } from '../../lib/email';
import { uid } from '../../lib/uid';

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

export type AdminRole = 'admin' | 'superadmin';

export interface AdminInvitationEntry {
  id:              string;
  email:           string;
  name:            string | null;
  role:            AdminRole;
  status:          'pending' | 'accepted' | 'rejected';
  invited_by_name: string | null;
  created_at:      Date;
  responded_at:    Date | null;
}

interface InvitationRow extends RowDataPacket {
  id:              string;
  email:           string;
  name:            string | null;
  role:            AdminRole;
  status:          'pending' | 'accepted' | 'rejected';
  invited_by_name: string | null;
  created_at:      Date;
  responded_at:    Date | null;
}

interface UserCheckRow extends RowDataPacket {
  id:           string;
  email:        string;
  name:         string | null;
  is_admin:     number;
  is_superadmin: number;
}

interface InviteTokenRow extends RowDataPacket {
  id:              string;
  user_id:         string;
  role:            AdminRole;
  status:          'pending' | 'accepted' | 'rejected';
  expires_at:      Date;
}

// ─── Permissions & Roles ─────────────────────────────────────────────────────

export interface SystemPermission {
  key:      string;
  name:     string;
  category: string;
}

export interface PlanPermissions {
  starter:    string[];
  pro:        string[];
  enterprise: string[];
}

export interface CustomRole {
  id:          string;
  name:        string;
  description: string | null;
  color:       string | null;
  permissions: string[];
  user_count:  number;
  created_at:  Date;
}

export interface RoleUser {
  id:          string;
  email:       string;
  name:        string | null;
  plan:        string;
  assigned_at: Date;
}

export const SYSTEM_PERMISSIONS: SystemPermission[] = [
  { key: 'posts.view',              name: 'View Posts',              category: 'Posts' },
  { key: 'posts.create',            name: 'Create Posts',            category: 'Posts' },
  { key: 'posts.edit',              name: 'Edit Posts',              category: 'Posts' },
  { key: 'posts.delete',            name: 'Delete Posts',            category: 'Posts' },
  { key: 'posts.publish',           name: 'Publish Posts',           category: 'Posts' },
  { key: 'posts.schedule',          name: 'Schedule Posts',          category: 'Posts' },
  { key: 'analytics.view',          name: 'View Analytics',          category: 'Analytics' },
  { key: 'analytics.export',        name: 'Export Analytics',        category: 'Analytics' },
  { key: 'calendar.view',           name: 'View Calendar',           category: 'Calendar' },
  { key: 'calendar.manage',         name: 'Manage Calendar',         category: 'Calendar' },
  { key: 'platforms.view',          name: 'View Platforms',          category: 'Platforms' },
  { key: 'platforms.connect',       name: 'Connect Platforms',       category: 'Platforms' },
  { key: 'platforms.disconnect',    name: 'Disconnect Platforms',    category: 'Platforms' },
  { key: 'ai.composer',             name: 'AI Composer',             category: 'AI Features' },
  { key: 'ai.settings',             name: 'AI Settings',             category: 'AI Features' },
  { key: 'ai.suggestions',          name: 'AI Suggestions',          category: 'AI Features' },
  { key: 'brand.view',              name: 'View Brand',              category: 'Brand' },
  { key: 'brand.manage',            name: 'Manage Brand',            category: 'Brand' },
  { key: 'rivals.view',             name: 'View Rivals',             category: 'Rivals' },
  { key: 'rivals.add',              name: 'Add Rivals',              category: 'Rivals' },
  { key: 'rivals.delete',           name: 'Delete Rivals',           category: 'Rivals' },
  { key: 'workspace.manage',        name: 'Manage Workspace',        category: 'Workspace' },
  { key: 'workspace.invite',        name: 'Invite Members',          category: 'Workspace' },
  { key: 'profile.edit',            name: 'Edit Profile',            category: 'Profile' },
  { key: 'profile.view_activity',   name: 'View Activity History',   category: 'Profile' },
];

const PLAN_DEFAULTS: Record<string, string[]> = {
  starter: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.delete', 'posts.schedule',
    'analytics.view',
    'calendar.view',
    'platforms.view', 'platforms.connect', 'platforms.disconnect',
    'brand.view', 'brand.manage',
    'profile.edit', 'profile.view_activity',
  ],
  pro: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.delete', 'posts.schedule', 'posts.publish',
    'analytics.view', 'analytics.export',
    'calendar.view', 'calendar.manage',
    'platforms.view', 'platforms.connect', 'platforms.disconnect',
    'ai.composer', 'ai.suggestions',
    'brand.view', 'brand.manage',
    'rivals.view', 'rivals.add', 'rivals.delete',
    'profile.edit', 'profile.view_activity',
  ],
  enterprise: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.delete', 'posts.schedule', 'posts.publish',
    'analytics.view', 'analytics.export',
    'calendar.view', 'calendar.manage',
    'platforms.view', 'platforms.connect', 'platforms.disconnect',
    'ai.composer', 'ai.settings', 'ai.suggestions',
    'brand.view', 'brand.manage',
    'rivals.view', 'rivals.add', 'rivals.delete',
    'workspace.manage', 'workspace.invite',
    'profile.edit', 'profile.view_activity',
  ],
};

async function initRolesTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_permissions (
      plan        VARCHAR(20)  NOT NULL,
      permission  VARCHAR(100) NOT NULL,
      PRIMARY KEY (plan, permission)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_roles (
      id          VARCHAR(24)  NOT NULL,
      name        VARCHAR(100) NOT NULL,
      description VARCHAR(255) NULL,
      color       VARCHAR(7)   NULL DEFAULT '#6366f1',
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_role_permissions (
      role_id    VARCHAR(24)  NOT NULL,
      permission VARCHAR(100) NOT NULL,
      PRIMARY KEY (role_id, permission)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_custom_roles (
      user_id     VARCHAR(24) NOT NULL,
      role_id     VARCHAR(24) NOT NULL,
      assigned_by VARCHAR(24) NULL,
      assigned_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [[{ total }]] = await pool.query<CountRow[]>('SELECT COUNT(*) AS total FROM plan_permissions');
  if (Number(total) === 0) {
    for (const [plan, perms] of Object.entries(PLAN_DEFAULTS)) {
      for (const perm of perms) {
        await pool.query('INSERT IGNORE INTO plan_permissions (plan, permission) VALUES (?, ?)', [plan, perm]);
      }
    }
  }
}

interface PlanPermRow extends RowDataPacket { plan: string; permission: string }
interface RoleRow extends RowDataPacket {
  id: string; name: string; description: string | null; color: string | null;
  user_count: number; created_at: Date;
}
interface RolePermRow extends RowDataPacket { role_id: string; permission: string }
interface RoleUserRow extends RowDataPacket {
  id: string; email: string; name: string | null; plan: string; assigned_at: Date;
}

export async function getPlanPermissions(): Promise<PlanPermissions> {
  const [rows] = await pool.query<PlanPermRow[]>('SELECT plan, permission FROM plan_permissions ORDER BY plan');
  const result: PlanPermissions = { starter: [], pro: [], enterprise: [] };
  for (const row of rows) {
    if (row.plan in result) (result as unknown as Record<string, string[]>)[row.plan].push(row.permission);
  }
  return result;
}

export async function setPlanPermissions(plan: string, permissions: string[]): Promise<void> {
  await pool.query('DELETE FROM plan_permissions WHERE plan = ?', [plan]);
  for (const perm of permissions) {
    await pool.query('INSERT INTO plan_permissions (plan, permission) VALUES (?, ?)', [plan, perm]);
  }
}

export async function getRoles(): Promise<CustomRole[]> {
  const [roles] = await pool.query<RoleRow[]>(`
    SELECT r.id, r.name, r.description, r.color, r.created_at,
           COUNT(DISTINCT ur.user_id) AS user_count
    FROM custom_roles r
    LEFT JOIN user_custom_roles ur ON ur.role_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `);

  const [perms] = await pool.query<RolePermRow[]>('SELECT role_id, permission FROM custom_role_permissions');
  const permMap: Record<string, string[]> = {};
  for (const row of perms) {
    if (!permMap[row.role_id]) permMap[row.role_id] = [];
    permMap[row.role_id].push(row.permission);
  }

  return roles.map(r => ({
    id:          r.id,
    name:        r.name,
    description: r.description,
    color:       r.color,
    permissions: permMap[r.id] ?? [],
    user_count:  Number(r.user_count),
    created_at:  r.created_at,
  }));
}

export async function createRole(
  name: string,
  description: string | null,
  color: string | null,
  permissions: string[],
): Promise<CustomRole> {
  const id = uid();
  const finalColor = color ?? '#6366f1';
  await pool.query(
    'INSERT INTO custom_roles (id, name, description, color) VALUES (?, ?, ?, ?)',
    [id, name, description, finalColor],
  );
  for (const perm of permissions) {
    await pool.query('INSERT INTO custom_role_permissions (role_id, permission) VALUES (?, ?)', [id, perm]);
  }
  return { id, name, description, color: finalColor, permissions, user_count: 0, created_at: new Date() };
}

export async function updateRole(
  id: string,
  name: string,
  description: string | null,
  color: string | null,
  permissions: string[],
): Promise<void> {
  const [[role]] = await pool.query<RowDataPacket[]>('SELECT id FROM custom_roles WHERE id = ? LIMIT 1', [id]);
  if (!role) throw Object.assign(new Error('Role not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  await pool.query('UPDATE custom_roles SET name = ?, description = ?, color = ? WHERE id = ?', [name, description, color, id]);
  await pool.query('DELETE FROM custom_role_permissions WHERE role_id = ?', [id]);
  for (const perm of permissions) {
    await pool.query('INSERT INTO custom_role_permissions (role_id, permission) VALUES (?, ?)', [id, perm]);
  }
}

export async function deleteRole(id: string): Promise<void> {
  const [[role]] = await pool.query<RowDataPacket[]>('SELECT id FROM custom_roles WHERE id = ? LIMIT 1', [id]);
  if (!role) throw Object.assign(new Error('Role not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  await pool.query('DELETE FROM user_custom_roles WHERE role_id = ?', [id]);
  await pool.query('DELETE FROM custom_role_permissions WHERE role_id = ?', [id]);
  await pool.query('DELETE FROM custom_roles WHERE id = ?', [id]);
}

export async function getRoleUsers(roleId: string): Promise<RoleUser[]> {
  const [rows] = await pool.query<RoleUserRow[]>(`
    SELECT u.id, u.email, u.name, u.plan, ur.assigned_at
    FROM user_custom_roles ur
    JOIN users u ON u.id = ur.user_id
    WHERE ur.role_id = ?
    ORDER BY ur.assigned_at DESC
  `, [roleId]);
  return rows.map(r => ({ id: r.id, email: r.email, name: r.name, plan: r.plan, assigned_at: r.assigned_at }));
}

export async function assignUserToRole(userId: string, roleId: string, assignedById: string): Promise<void> {
  const [[role]] = await pool.query<RowDataPacket[]>('SELECT id FROM custom_roles WHERE id = ? LIMIT 1', [roleId]);
  if (!role) throw Object.assign(new Error('Role not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  const [[user]] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!user) throw Object.assign(new Error('User not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  await pool.query(
    'INSERT IGNORE INTO user_custom_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
    [userId, roleId, assignedById],
  );
}

export async function removeUserFromRole(userId: string, roleId: string): Promise<void> {
  await pool.query('DELETE FROM user_custom_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
}

// Auto-create tables / columns needed for admin invitations
export async function initAdminTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_invitations (
      id               VARCHAR(24)  NOT NULL,
      user_id          VARCHAR(24)  NOT NULL,
      email            VARCHAR(255) NOT NULL,
      token            VARCHAR(64)  NOT NULL,
      role             ENUM('admin','superadmin') NOT NULL DEFAULT 'admin',
      status           ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
      invited_by_id    VARCHAR(24)  NULL,
      invited_by_name  VARCHAR(255) NULL,
      created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at     DATETIME     NULL,
      expires_at       DATETIME     NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_token (token),
      INDEX idx_email (email),
      INDEX idx_user  (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Add is_superadmin to users if missing — MySQL doesn't support IF NOT EXISTS for columns,
  // so we catch the duplicate column error and continue.
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN is_superadmin TINYINT(1) NOT NULL DEFAULT 0`);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code !== 'ER_DUP_FIELDNAME') throw e;
  }

  await initRolesTables();
}

export async function getAdmins(): Promise<AdminInvitationEntry[]> {
  const [rows] = await pool.query<InvitationRow[]>(`
    SELECT
      i.id, i.email, u.name, i.role, i.status,
      i.invited_by_name, i.created_at, i.responded_at
    FROM admin_invitations i
    JOIN users u ON u.id = i.user_id
    ORDER BY i.created_at DESC
  `);
  return rows.map(r => ({
    id:              r.id,
    email:           r.email,
    name:            r.name,
    role:            r.role,
    status:          r.status,
    invited_by_name: r.invited_by_name,
    created_at:      r.created_at,
    responded_at:    r.responded_at,
  }));
}

export async function addAdmin(
  email: string,
  role: AdminRole,
  invitedById: string,
  invitedByName: string | null,
): Promise<AdminInvitationEntry> {
  const [[user]] = await pool.query<UserCheckRow[]>(
    'SELECT id, email, name, is_admin, is_superadmin FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  if (!user) throw Object.assign(new Error('No user found with that email'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  // Block if there's already a pending or accepted invitation
  const [[existing]] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM admin_invitations WHERE user_id = ? AND status IN ('pending','accepted') LIMIT 1`,
    [user.id],
  );
  if (existing) throw Object.assign(new Error('This user already has an active or pending admin invitation'), { errorCode: 'CONFLICT', statusCode: 409 });

  const id      = uid();
  const token   = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  await pool.query(
    `INSERT INTO admin_invitations (id, user_id, email, token, role, status, invited_by_id, invited_by_name, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, user.id, user.email, token, role, invitedById, invitedByName, expires],
  );

  sendAdminInviteEmail(user.email, {
    name:    user.name ?? undefined,
    addedBy: invitedByName ?? undefined,
    token,
  });

  return {
    id,
    email:           user.email,
    name:            user.name,
    role,
    status:          'pending',
    invited_by_name: invitedByName,
    created_at:      new Date(),
    responded_at:    null,
  };
}

export async function removeAdmin(invitationId: string, requesterId: string): Promise<void> {
  const [[inv]] = await pool.query<RowDataPacket[]>(
    'SELECT id, user_id, status FROM admin_invitations WHERE id = ? LIMIT 1',
    [invitationId],
  );
  if (!inv) throw Object.assign(new Error('Invitation not found'), { errorCode: 'NOT_FOUND', statusCode: 404 });

  const row = inv as { id: string; user_id: string; status: string };
  if (row.user_id === requesterId) {
    throw Object.assign(new Error('You cannot remove your own admin access'), { errorCode: 'FORBIDDEN', statusCode: 403 });
  }

  await pool.query('DELETE FROM admin_invitations WHERE id = ?', [invitationId]);

  // If invitation was accepted, revoke is_admin / is_superadmin from user
  if (row.status === 'accepted') {
    await pool.query('UPDATE users SET is_admin = 0, is_superadmin = 0 WHERE id = ?', [row.user_id]);
  }
}

export async function respondToInvite(token: string, action: 'accept' | 'reject'): Promise<{ status: 'accepted' | 'rejected'; email: string }> {
  const [[inv]] = await pool.query<InviteTokenRow[]>(
    `SELECT id, user_id, role, status, expires_at
     FROM admin_invitations WHERE token = ? LIMIT 1`,
    [token],
  );
  if (!inv) throw Object.assign(new Error('Invalid or expired invitation link'), { errorCode: 'NOT_FOUND', statusCode: 404 });
  if (inv.status !== 'pending') throw Object.assign(new Error(`Invitation already ${inv.status}`), { errorCode: 'CONFLICT', statusCode: 409 });
  if (new Date() > inv.expires_at) throw Object.assign(new Error('Invitation link has expired'), { errorCode: 'EXPIRED', statusCode: 410 });

  const newStatus = action === 'accept' ? 'accepted' : 'rejected';

  await pool.query(
    `UPDATE admin_invitations SET status = ?, responded_at = NOW() WHERE id = ?`,
    [newStatus, inv.id],
  );

  if (action === 'accept') {
    const isSuperadmin = inv.role === 'superadmin' ? 1 : 0;
    await pool.query(
      'UPDATE users SET is_admin = 1, is_superadmin = ? WHERE id = ?',
      [isSuperadmin, inv.user_id],
    );
  }

  const [[userRow]] = await pool.query<RowDataPacket[]>(
    'SELECT email FROM users WHERE id = ? LIMIT 1',
    [inv.user_id],
  );

  return { status: newStatus, email: (userRow as { email: string }).email };
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
