import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';

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
    'SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at ASC',
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
