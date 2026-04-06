import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FacebookConnectionRow extends RowDataPacket {
  page_id:      string;
  access_token: string;
  account_name: string;
}

// Graph API response shapes
interface FbInsightValue {
  value: number;
  end_time: string;
}

interface FbInsightItem {
  name:   string;
  values: FbInsightValue[];
}

interface FbInsightsResponse {
  data:  FbInsightItem[];
  error?: { code: number; message: string; type: string };
}

interface FbPageFieldsResponse {
  id:        string;
  fan_count: number;
  error?: { code: number; message: string; type: string };
}

interface FbAttachment {
  type:  string;
  media?: { image?: { src: string } };
}

interface FbPost {
  id:           string;
  message?:     string;
  created_time: string;
  attachments?: { data: FbAttachment[] };
  insights?:    { data: FbInsightItem[] };
}

interface FbPostsResponse {
  data:  FbPost[];
  error?: { code: number; message: string; type: string };
}

export interface PostMetrics {
  id:           string;
  message:      string | null;
  created_time: string;
  thumbnail:    string | null;
  impressions:  number;
  reach:        number;
  engaged_users: number;
  reactions:    number;
}

export interface FacebookSummary {
  fan_count:          number;
  impressions_30d:    number;
  reach_30d:          number;
  engaged_users_30d:  number;
  period: {
    since: string;
    until: string;
  };
}

// ─── Graph API helper ─────────────────────────────────────────────────────────

async function fbGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v21.0${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const json = await res.json() as T & { error?: { code: number; message: string; type: string } };

  if (!res.ok || (json as { error?: { code: number } }).error) {
    const err = (json as { error?: { code: number; message: string } }).error;
    const graphError = new GraphApiError(
      err?.message ?? `Graph API error on ${path}`,
      err?.code ?? res.status,
    );
    throw graphError;
  }

  return json;
}

class GraphApiError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'GraphApiError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Sum all daily values for a given metric name across the insights array */
function sumMetric(items: FbInsightItem[], name: string): number {
  const item = items.find(i => i.name === name);
  if (!item) return 0;
  return item.values.reduce((acc, v) => acc + (v.value as number), 0);
}

/** Format a Date as YYYY-MM-DD */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Public service functions ─────────────────────────────────────────────────

async function getFacebookConnection(userId: string): Promise<FacebookConnectionRow> {
  const [rows] = await pool.query<FacebookConnectionRow[]>(
    `SELECT page_id, access_token, account_name
       FROM social_connections
      WHERE user_id = ? AND platform = 'facebook' AND page_id IS NOT NULL
      LIMIT 1`,
    [userId],
  );

  if (!rows.length) {
    const err = Object.assign(new Error('No Facebook page connection found for this account.'), { code: 'NO_FACEBOOK_CONNECTION' });
    throw err;
  }

  return rows[0];
}

export async function getFacebookSummary(userId: string): Promise<FacebookSummary> {
  const conn = await getFacebookConnection(userId);
  const { page_id, access_token } = conn;

  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);

  const sinceUnix = String(Math.floor(since.getTime() / 1000));
  const untilUnix = String(Math.floor(until.getTime() / 1000));

  // Run fan_count and insights in parallel
  const [pageFields, insights] = await Promise.all([
    fbGet<FbPageFieldsResponse>(`/${page_id}`, access_token, {
      fields: 'fan_count',
    }),
    fbGet<FbInsightsResponse>(`/${page_id}/insights`, access_token, {
      metric: 'page_impressions,page_impressions_unique,page_engaged_users',
      period: 'day',
      since:  sinceUnix,
      until:  untilUnix,
    }),
  ]);

  return {
    fan_count:         pageFields.fan_count ?? 0,
    impressions_30d:   sumMetric(insights.data, 'page_impressions'),
    reach_30d:         sumMetric(insights.data, 'page_impressions_unique'),
    engaged_users_30d: sumMetric(insights.data, 'page_engaged_users'),
    period: {
      since: toDateStr(since),
      until: toDateStr(until),
    },
  };
}

export async function getFacebookPosts(userId: string): Promise<PostMetrics[]> {
  const conn = await getFacebookConnection(userId);
  const { page_id, access_token } = conn;

  const postsResponse = await fbGet<FbPostsResponse>(`/${page_id}/posts`, access_token, {
    fields: [
      'id',
      'message',
      'created_time',
      'attachments{type,media}',
      'insights.metric(post_impressions,post_reach,post_engaged_users,post_reactions_by_type_total)',
    ].join(','),
    limit: '10',
  });

  return postsResponse.data.map((post): PostMetrics => {
    const insightItems: FbInsightItem[] = post.insights?.data ?? [];

    // post_reactions_by_type_total has object values {LIKE: N, LOVE: N, ...}
    // sum all reaction types
    const reactionsItem = insightItems.find(i => i.name === 'post_reactions_by_type_total');
    const reactions = reactionsItem?.values.reduce((acc, v) => {
      if (typeof v.value === 'object' && v.value !== null) {
        return acc + Object.values(v.value as Record<string, number>).reduce((s, n) => s + n, 0);
      }
      return acc + (v.value as number);
    }, 0) ?? 0;

    const thumbnail = post.attachments?.data?.[0]?.media?.image?.src ?? null;

    return {
      id:            post.id,
      message:       post.message ?? null,
      created_time:  post.created_time,
      thumbnail,
      impressions:   sumMetric(insightItems, 'post_impressions'),
      reach:         sumMetric(insightItems, 'post_reach'),
      engaged_users: sumMetric(insightItems, 'post_engaged_users'),
      reactions,
    };
  });
}

// ─── Graph API error classifier (used by controller) ─────────────────────────

export function classifyGraphError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof GraphApiError) {
    if (err.code === 190) {
      return { status: 401, code: 'TOKEN_EXPIRED', message: 'Your Facebook token has expired. Please reconnect your account.' };
    }
    if (err.code === 10 || err.code === 200) {
      return { status: 403, code: 'INSUFFICIENT_PERMISSIONS', message: 'Missing permissions to read Facebook insights. Please reconnect and grant the required permissions.' };
    }
    return { status: 502, code: 'GRAPH_API_ERROR', message: err.message };
  }

  if ((err as { code?: string }).code === 'NO_FACEBOOK_CONNECTION') {
    return { status: 404, code: 'NO_FACEBOOK_CONNECTION', message: (err as Error).message };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}
