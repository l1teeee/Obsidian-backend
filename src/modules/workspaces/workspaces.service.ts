import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';

type ChannelId = 'ig' | 'fb' | 'li';

const PLATFORM_TO_CHANNEL: Record<string, ChannelId> = {
  instagram: 'ig',
  facebook:  'fb',
  meta:      'fb',
  linkedin:  'li',
};

const POST_THRESHOLD = 10;

interface WorkspaceRow extends RowDataPacket {
  id:         string;
  user_id:    string;
  name:       string;
  created_at: Date;
  updated_at: Date;
}

export interface Workspace {
  id:         string;
  user_id:    string;
  name:       string;
  created_at: Date;
  updated_at: Date;
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

async function getById(id: string, userId: string): Promise<Workspace> {
  const [rows] = await pool.query<WorkspaceRow[]>(
    'SELECT * FROM workspaces WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  const row = rows[0];
  if (!row) throw appError('NOT_FOUND', 'Workspace not found', 404);
  return row;
}

export async function getWorkspaces(userId: string): Promise<Workspace[]> {
  const [rows] = await pool.query<WorkspaceRow[]>(
    'SELECT * FROM workspaces WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC',
    [userId]
  );
  return rows;
}

const WORKSPACE_LIMIT = 5;

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const [[{ total }]] = await pool.query<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM workspaces WHERE user_id = ?',
    [userId]
  );

  if (total >= WORKSPACE_LIMIT) {
    throw appError('LIMIT_REACHED', `You can have a maximum of ${WORKSPACE_LIMIT} workspaces`, 422);
  }

  const id = uid();

  await pool.query<ResultSetHeader>(
    'INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, ?)',
    [id, userId, name.trim()]
  );

  // Mark user as no longer first-time once they create their workspace
  await pool.query('UPDATE users SET first_login = 0 WHERE id = ?', [userId]);

  return getById(id, userId);
}

export async function updateWorkspace(id: string, userId: string, name: string): Promise<Workspace> {
  const [check] = await pool.query<WorkspaceRow[]>(
    'SELECT id FROM workspaces WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  if (check.length === 0) throw appError('NOT_FOUND', 'Workspace not found', 404);

  await pool.query(
    'UPDATE workspaces SET name = ? WHERE id = ? AND user_id = ?',
    [name.trim(), id, userId]
  );
  return getById(id, userId);
}

export async function deleteWorkspace(id: string, userId: string): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM workspaces WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (result.affectedRows === 0) throw appError('NOT_FOUND', 'Workspace not found', 404);
}

// ── Preferred channel ─────────────────────────────────────────────────────────

export interface PreferredChannelResult {
  preferred:    ChannelId | null;
  autoDetected: boolean;
  totalPosts:   number;
}

export async function getPreferredChannel(workspaceId: string, userId: string): Promise<PreferredChannelResult> {
  const [wsRows] = await pool.query<(WorkspaceRow & { preferred_channel: string | null })[]>(
    'SELECT preferred_channel FROM workspaces WHERE id = ? AND user_id = ? LIMIT 1',
    [workspaceId, userId],
  );
  if (!wsRows[0]) throw appError('NOT_FOUND', 'Workspace not found', 404);
  const manual = wsRows[0].preferred_channel as ChannelId | null;

  // Count published posts per platform (user-level — posts table has no workspace_id)
  const [rows] = await pool.query<(RowDataPacket & { platform: string; cnt: number })[]>(
    `SELECT platform, COUNT(*) AS cnt FROM posts
     WHERE user_id = ? AND status = 'published'
     GROUP BY platform`,
    [userId],
  );
  const totalPosts = rows.reduce((sum, r) => sum + Number(r.cnt), 0);

  // Manual override always takes precedence
  if (manual !== null) {
    return { preferred: manual, autoDetected: false, totalPosts };
  }

  // Below threshold and no manual → no preferred yet
  if (totalPosts < POST_THRESHOLD) {
    return { preferred: null, autoDetected: false, totalPosts };
  }

  // >= threshold, no manual → auto-detect dominant channel
  const counts: Record<ChannelId, number> = { ig: 0, fb: 0, li: 0 };
  for (const row of rows) {
    const ch = PLATFORM_TO_CHANNEL[row.platform];
    if (ch) counts[ch] += Number(row.cnt);
  }

  const dominant = (Object.entries(counts) as [ChannelId, number][])
    .sort((a, b) => b[1] - a[1])
    .find(([, cnt]) => cnt > 0);

  return { preferred: dominant?.[0] ?? null, autoDetected: true, totalPosts };
}

export async function setPreferredChannel(workspaceId: string, userId: string, channel: ChannelId | null): Promise<void> {
  const [check] = await pool.query<WorkspaceRow[]>(
    'SELECT id FROM workspaces WHERE id = ? AND user_id = ? LIMIT 1',
    [workspaceId, userId],
  );
  if (!check[0]) throw appError('NOT_FOUND', 'Workspace not found', 404);

  await pool.query(
    'UPDATE workspaces SET preferred_channel = ? WHERE id = ? AND user_id = ?',
    [channel, workspaceId, userId],
  );
}
