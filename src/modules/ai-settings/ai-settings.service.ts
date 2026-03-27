import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';

export interface AiSettings {
  id:                  string;
  workspace_id:        string;
  persona:             string | null;
  brand_voice:         string | null;
  target_audience:     string | null;
  content_pillars:     string | null;
  hashtag_strategy:    string | null;
  example_posts:       string | null;
  avoid:               string | null;
  custom_instructions: string | null;
  created_at:          Date;
  updated_at:          Date;
}

interface AiSettingsRow extends AiSettings, RowDataPacket {}

export interface UpsertAiSettingsData {
  persona?:             string;
  brand_voice?:         string;
  target_audience?:     string;
  content_pillars?:     string;
  hashtag_strategy?:    string;
  example_posts?:       string;
  avoid?:               string;
  custom_instructions?: string;
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

/** Verify the workspace exists and belongs to the user */
async function assertWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
  interface WsRow extends RowDataPacket { id: string }
  const [rows] = await pool.query<WsRow[]>(
    'SELECT id FROM workspaces WHERE id = ? AND user_id = ? LIMIT 1',
    [workspaceId, userId],
  );
  if (rows.length === 0) throw appError('NOT_FOUND', 'Workspace not found', 404);
}

export async function getByWorkspace(workspaceId: string, userId: string): Promise<AiSettings | null> {
  await assertWorkspaceOwner(workspaceId, userId);
  const [rows] = await pool.query<AiSettingsRow[]>(
    'SELECT * FROM ai_settings WHERE workspace_id = ? LIMIT 1',
    [workspaceId],
  );
  return rows[0] ?? null;
}

export async function upsert(
  workspaceId: string,
  userId:      string,
  data:        UpsertAiSettingsData,
): Promise<AiSettings> {
  await assertWorkspaceOwner(workspaceId, userId);

  const [existing] = await pool.query<AiSettingsRow[]>(
    'SELECT id FROM ai_settings WHERE workspace_id = ? LIMIT 1',
    [workspaceId],
  );

  if (existing.length === 0) {
    const id = uid();
    await pool.query(
      `INSERT INTO ai_settings
         (id, workspace_id, persona, brand_voice, target_audience, content_pillars,
          hashtag_strategy, example_posts, avoid, custom_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, workspaceId,
        data.persona             ?? null,
        data.brand_voice         ?? null,
        data.target_audience     ?? null,
        data.content_pillars     ?? null,
        data.hashtag_strategy    ?? null,
        data.example_posts       ?? null,
        data.avoid               ?? null,
        data.custom_instructions ?? null,
      ],
    );
  } else {
    const fields: string[]  = [];
    const values: unknown[] = [];

    if (data.persona             !== undefined) { fields.push('persona = ?');             values.push(data.persona);             }
    if (data.brand_voice         !== undefined) { fields.push('brand_voice = ?');         values.push(data.brand_voice);         }
    if (data.target_audience     !== undefined) { fields.push('target_audience = ?');     values.push(data.target_audience);     }
    if (data.content_pillars     !== undefined) { fields.push('content_pillars = ?');     values.push(data.content_pillars);     }
    if (data.hashtag_strategy    !== undefined) { fields.push('hashtag_strategy = ?');    values.push(data.hashtag_strategy);    }
    if (data.example_posts       !== undefined) { fields.push('example_posts = ?');       values.push(data.example_posts);       }
    if (data.avoid               !== undefined) { fields.push('avoid = ?');               values.push(data.avoid);               }
    if (data.custom_instructions !== undefined) { fields.push('custom_instructions = ?'); values.push(data.custom_instructions); }

    if (fields.length > 0) {
      values.push(workspaceId);
      await pool.query(
        `UPDATE ai_settings SET ${fields.join(', ')} WHERE workspace_id = ?`,
        values,
      );
    }
  }

  const [rows] = await pool.query<AiSettingsRow[]>(
    'SELECT * FROM ai_settings WHERE workspace_id = ? LIMIT 1',
    [workspaceId],
  );
  return rows[0]!;
}

/** Fetch raw settings to pass as context to the AI — no auth check needed (internal use) */
export async function getRawByWorkspace(workspaceId: string): Promise<AiSettings | null> {
  const [rows] = await pool.query<AiSettingsRow[]>(
    'SELECT * FROM ai_settings WHERE workspace_id = ? LIMIT 1',
    [workspaceId],
  );
  return rows[0] ?? null;
}
