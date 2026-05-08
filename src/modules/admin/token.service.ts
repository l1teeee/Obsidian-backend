import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';

export interface TokenStats {
  total_tokens:       number;
  input_tokens:       number;
  output_tokens:      number;
  total_calls:        number;
  unique_users:       number;
  estimated_cost_usd: number;
  top_tool:           string | null;
}

export interface ToolBreakdown {
  tool:          string;
  total_tokens:  number;
  input_tokens:  number;
  output_tokens: number;
  total_calls:   number;
  pct:           number;
}

export interface TopUser {
  user_id:      string;
  email:        string;
  name:         string | null;
  total_tokens: number;
  total_calls:  number;
}

export interface TokenLimit {
  plan:          string;
  monthly_limit: number;
}

const DEFAULT_LIMITS: Record<string, number> = {
  free:       10_000,
  starter:    50_000,
  pro:        200_000,
  enterprise: 0,
};

const PRICE_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o':       { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4-turbo':  { input: 10.00, output: 30.00 },
};
const DEFAULT_PRICE = { input: 5.00, output: 15.00 };

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const price = PRICE_PER_1M[model] ?? DEFAULT_PRICE;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

interface CountRow extends RowDataPacket { cnt: number }
interface StatsRow  extends RowDataPacket {
  total_tokens: number; input_tokens: number; output_tokens: number;
  total_calls: number; unique_users: number;
}
interface ToolRow   extends RowDataPacket {
  tool: string; total_tokens: number; input_tokens: number;
  output_tokens: number; total_calls: number;
}
interface CostRow   extends RowDataPacket { model: string; input_tokens: number; output_tokens: number }
interface UserRow   extends RowDataPacket {
  user_id: string; email: string; name: string | null;
  total_tokens: number; total_calls: number;
}
interface LimitRow  extends RowDataPacket { plan: string; monthly_limit: number }
interface UsageRow  extends RowDataPacket { total: number }

export async function initTokenTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id            CHAR(36)     NOT NULL DEFAULT (UUID()),
      user_id       CHAR(36)     NOT NULL,
      workspace_id  CHAR(36)     NULL,
      tool          VARCHAR(50)  NOT NULL,
      model         VARCHAR(100) NOT NULL DEFAULT '',
      input_tokens  INT          NOT NULL DEFAULT 0,
      output_tokens INT          NOT NULL DEFAULT 0,
      total_tokens  INT          NOT NULL DEFAULT 0,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_user_created (user_id, created_at),
      INDEX idx_tool_created (tool, created_at),
      INDEX idx_created_at   (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_limits (
      plan          VARCHAR(20) NOT NULL,
      monthly_limit INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (plan)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [[{ cnt }]] = await pool.query<CountRow[]>('SELECT COUNT(*) AS cnt FROM token_limits');
  if (Number(cnt) === 0) {
    for (const [plan, limit] of Object.entries(DEFAULT_LIMITS)) {
      await pool.query('INSERT IGNORE INTO token_limits (plan, monthly_limit) VALUES (?, ?)', [plan, limit]);
    }
  }
}

export async function logTokenUsage(
  userId:       string,
  workspaceId:  string | null,
  tool:         string,
  model:        string,
  inputTokens:  number,
  outputTokens: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO token_usage (user_id, workspace_id, tool, model, input_tokens, output_tokens, total_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, workspaceId ?? null, tool, model, inputTokens, outputTokens, inputTokens + outputTokens],
  );
}

function dateFilter(period: string, alias = ''): string {
  const col = alias ? `${alias}.created_at` : 'created_at';
  if (period === '7d')  return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  if (period === '30d') return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
  if (period === '90d') return `AND ${col} >= DATE_SUB(NOW(), INTERVAL 90 DAY)`;
  return '';
}

export async function getTokenStats(period = '30d'): Promise<TokenStats> {
  const f = dateFilter(period);
  const [[stats]] = await pool.query<StatsRow[]>(`
    SELECT
      COALESCE(SUM(total_tokens), 0)  AS total_tokens,
      COALESCE(SUM(input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COUNT(*)                        AS total_calls,
      COUNT(DISTINCT user_id)         AS unique_users
    FROM token_usage WHERE 1=1 ${f}
  `);
  const [toolRows] = await pool.query<ToolRow[]>(`
    SELECT tool, SUM(total_tokens) AS total_tokens
    FROM token_usage WHERE 1=1 ${f}
    GROUP BY tool ORDER BY total_tokens DESC LIMIT 1
  `);
  const [costRows] = await pool.query<CostRow[]>(`
    SELECT model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
    FROM token_usage WHERE 1=1 ${f}
    GROUP BY model
  `);
  const cost = costRows.reduce(
    (acc, r) => acc + estimateCost(Number(r.input_tokens), Number(r.output_tokens), r.model),
    0,
  );
  return {
    total_tokens:       Number(stats.total_tokens),
    input_tokens:       Number(stats.input_tokens),
    output_tokens:      Number(stats.output_tokens),
    total_calls:        Number(stats.total_calls),
    unique_users:       Number(stats.unique_users),
    estimated_cost_usd: Math.round(cost * 10_000) / 10_000,
    top_tool:           toolRows[0]?.tool ?? null,
  };
}

export async function getToolBreakdown(period = '30d'): Promise<ToolBreakdown[]> {
  const f = dateFilter(period);
  const [rows] = await pool.query<ToolRow[]>(`
    SELECT tool,
      SUM(total_tokens)  AS total_tokens,
      SUM(input_tokens)  AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      COUNT(*)           AS total_calls
    FROM token_usage WHERE 1=1 ${f}
    GROUP BY tool ORDER BY total_tokens DESC
  `);
  const grandTotal = rows.reduce((s, r) => s + Number(r.total_tokens), 0);
  return rows.map(r => ({
    tool:          r.tool,
    total_tokens:  Number(r.total_tokens),
    input_tokens:  Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    total_calls:   Number(r.total_calls),
    pct:           grandTotal > 0 ? Math.round((Number(r.total_tokens) / grandTotal) * 1000) / 10 : 0,
  }));
}

export async function getTopUsers(period = '30d', limit = 10): Promise<TopUser[]> {
  const f = dateFilter(period, 't');
  const [rows] = await pool.query<UserRow[]>(`
    SELECT t.user_id, u.email, u.name,
      SUM(t.total_tokens) AS total_tokens,
      COUNT(*)            AS total_calls
    FROM token_usage t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE 1=1 ${f}
    GROUP BY t.user_id, u.email, u.name
    ORDER BY total_tokens DESC
    LIMIT ${Number(limit)}
  `);
  return rows.map(r => ({
    user_id:      r.user_id,
    email:        r.email ?? 'unknown',
    name:         r.name,
    total_tokens: Number(r.total_tokens),
    total_calls:  Number(r.total_calls),
  }));
}

export async function getTokenLimits(): Promise<TokenLimit[]> {
  const [rows] = await pool.query<LimitRow[]>(
    `SELECT plan, monthly_limit FROM token_limits
     ORDER BY FIELD(plan, 'free', 'starter', 'pro', 'enterprise')`,
  );
  return rows;
}

export async function setTokenLimit(plan: string, monthlyLimit: number): Promise<void> {
  await pool.query(
    `INSERT INTO token_limits (plan, monthly_limit) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE monthly_limit = ?`,
    [plan, monthlyLimit, monthlyLimit],
  );
}

export async function getUserMonthlyUsage(userId: string): Promise<number> {
  const [[row]] = await pool.query<UsageRow[]>(
    `SELECT COALESCE(SUM(total_tokens), 0) AS total
     FROM token_usage
     WHERE user_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [userId],
  );
  return Number(row.total);
}

export async function checkTokenLimit(
  userId: string, plan: string,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const [limitRows] = await pool.query<Array<{ monthly_limit: number } & RowDataPacket>>(
    'SELECT monthly_limit FROM token_limits WHERE plan = ?', [plan],
  );
  const limit = Number(limitRows[0]?.monthly_limit ?? 0);
  if (limit === 0) return { allowed: true, used: 0, limit: 0 };
  const used = await getUserMonthlyUsage(userId);
  return { allowed: used < limit, used, limit };
}
