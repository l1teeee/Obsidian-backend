import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { cache, TTL } from '../../lib/cache';
import { decryptToken } from '../../lib/crypto';
import type {
  FacebookConnectionRow,
  FbInsightItem,
  FbInsightsResponse,
  FbPageFieldsResponse,
  FbPost,
  FbPostsResponse,
  PostMetrics,
  FacebookSummary,
} from './metrics.types';

export type { PostMetrics, FacebookSummary };

// ─── Graph API helper ─────────────────────────────────────────────────────────

async function fbGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v21.0${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res  = await fetch(url.toString());
  const json = await res.json() as T & { error?: { code: number; message: string; type: string } };

  if (!res.ok || (json as { error?: { code: number } }).error) {
    const err = (json as { error?: { code: number; message: string } }).error;
    throw new GraphApiError(
      err?.message ?? `Graph API error on ${path}`,
      err?.code     ?? res.status,
    );
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

function sumMetric(items: FbInsightItem[], name: string): number {
  const item = items.find(i => i.name === name);
  if (!item) return 0;
  return item.values.reduce((acc, v) => acc + (v.value as number), 0);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumReactions(insightItems: FbInsightItem[]): number {
  const item = insightItems.find(i => i.name === 'post_reactions_by_type_total');
  return item?.values.reduce((acc, v) => {
    if (typeof v.value === 'object' && v.value !== null) {
      return acc + Object.values(v.value as Record<string, number>).reduce((s, n) => s + n, 0);
    }
    return acc + (v.value as number);
  }, 0) ?? 0;
}

function mapPost(post: FbPost): PostMetrics {
  const insightItems: FbInsightItem[] = post.insights?.data ?? [];
  return {
    id:            post.id,
    message:       post.message ?? null,
    created_time:  post.created_time,
    thumbnail:     post.attachments?.data?.[0]?.media?.image?.src ?? null,
    impressions:   sumMetric(insightItems, 'post_media_view'),
    reach:         sumMetric(insightItems, 'post_total_media_view_unique'),
    engaged_users: sumMetric(insightItems, 'post_clicks'),
    reactions:     sumReactions(insightItems),
  };
}

const POST_FIELDS = [
  'id',
  'message',
  'created_time',
  'attachments{type,media}',
  'insights.metric(post_media_view,post_total_media_view_unique,post_clicks,post_reactions_by_type_total)',
].join(',');

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getFacebookConnection(userId: string): Promise<FacebookConnectionRow> {
  const [rows] = await pool.query<FacebookConnectionRow[]>(
    `SELECT page_id, access_token, account_name
       FROM social_connections
      WHERE user_id = ? AND platform = 'facebook' AND page_id IS NOT NULL
      LIMIT 1`,
    [userId],
  );

  if (!rows.length) {
    throw Object.assign(
      new Error('No Facebook page connection found for this account.'),
      { code: 'NO_FACEBOOK_CONNECTION' },
    );
  }

  const row = rows[0];
  return { ...row, access_token: decryptToken(row.access_token) };
}

// ─── Public service functions ─────────────────────────────────────────────────

export async function getFacebookSummary(userId: string): Promise<FacebookSummary> {
  const key = `fb:summary:${userId}`;
  const hit = cache.get<FacebookSummary>(key);
  if (hit) return hit;

  const { page_id, access_token } = await getFacebookConnection(userId);

  const until     = new Date();
  const since     = new Date(until);
  since.setDate(since.getDate() - 30);
  const sinceUnix = String(Math.floor(since.getTime() / 1000));
  const untilUnix = String(Math.floor(until.getTime()  / 1000));

  const [pageFields, insights] = await Promise.all([
    fbGet<FbPageFieldsResponse>(`/${page_id}`, access_token, { fields: 'fan_count' }),
    fbGet<FbInsightsResponse>(`/${page_id}/insights`, access_token, {
      metric: 'page_posts_impressions,page_posts_impressions_unique,page_post_engagements',
      period: 'day',
      since:  sinceUnix,
      until:  untilUnix,
    }),
  ]);

  const result: FacebookSummary = {
    fan_count:         pageFields.fan_count ?? 0,
    impressions_30d:   sumMetric(insights.data, 'page_posts_impressions'),
    reach_30d:         sumMetric(insights.data, 'page_posts_impressions_unique'),
    engaged_users_30d: sumMetric(insights.data, 'page_post_engagements'),
    period: { since: toDateStr(since), until: toDateStr(until) },
  };
  cache.set(key, result, TTL.THIRTY_MIN);
  return result;
}

export async function getFacebookPosts(userId: string): Promise<PostMetrics[]> {
  const key = `fb:posts:${userId}`;
  const hit = cache.get<PostMetrics[]>(key);
  if (hit) return hit;

  const { page_id, access_token } = await getFacebookConnection(userId);

  // Fetch from Facebook and get the user's active local posts in parallel
  const [fbRes, [localRows]] = await Promise.all([
    fbGet<FbPostsResponse>(`/${page_id}/posts`, access_token, {
      fields: POST_FIELDS,
      limit:  '20',
    }),
    pool.query<({ platform_post_id: string } & import('mysql2').RowDataPacket)[]>(
      `SELECT platform_post_id
         FROM posts
        WHERE user_id = ?
          AND platform = 'facebook'
          AND platform_post_id IS NOT NULL
          AND status NOT IN ('inactive', 'deleted')`,
      [userId],
    ),
  ]);

  // Only include FB posts that were created through the app by this user
  const idMap    = new Map(localRows.map(r => [r.platform_post_id, r.id]));
  const filtered = fbRes.data.filter(p => idMap.has(p.id));

  const result = filtered.map(p => ({ ...mapPost(p), local_id: idMap.get(p.id) }));
  cache.set(key, result, TTL.FIFTEEN_MIN);
  return result;
}

export async function getFacebookPostById(userId: string, postId: string): Promise<PostMetrics> {
  const { access_token } = await getFacebookConnection(userId);
  const post = await fbGet<FbPost>(`/${postId}`, access_token, { fields: POST_FIELDS });
  return mapPost(post);
}

// ─── getDashboardSummary ──────────────────────────────────────────────────────

export interface DashboardSummary {
  posts: {
    total:                number;
    published:            number;
    scheduled:            number;
    draft:                number;
    published_this_week:  number;
  };
  platforms_connected: number;
}

interface PostCountRow extends RowDataPacket {
  total:                number;
  published:            number;
  scheduled:            number;
  draft:                number;
  published_this_week:  number;
}

interface CountRow extends RowDataPacket {
  count: number;
}

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const key = `dashboard:summary:${userId}`;
  const hit = cache.get<DashboardSummary>(key);
  if (hit) return hit;

  const [[postCounts], [platformRow]] = await Promise.all([
    pool.query<PostCountRow[]>(
      `SELECT
         COUNT(*)                                                               AS total,
         SUM(status = 'published')                                              AS published,
         SUM(status = 'scheduled')                                              AS scheduled,
         SUM(status = 'draft')                                                  AS draft,
         SUM(status = 'published' AND created_at >= NOW() - INTERVAL 7 DAY)    AS published_this_week
       FROM posts
       WHERE user_id = ? AND status != 'deleted'`,
      [userId],
    ),
    pool.query<CountRow[]>(
      `SELECT COUNT(*) AS count FROM social_connections WHERE user_id = ? AND is_active = 1`,
      [userId],
    ),
  ]);

  const row = postCounts[0] ?? { total: 0, published: 0, scheduled: 0, draft: 0, published_this_week: 0 };

  const result: DashboardSummary = {
    posts: {
      total:               Number(row.total),
      published:           Number(row.published),
      scheduled:           Number(row.scheduled),
      draft:               Number(row.draft),
      published_this_week: Number(row.published_this_week),
    },
    platforms_connected: Number(platformRow[0]?.count ?? 0),
  };
  cache.set(key, result, TTL.FIVE_MIN);
  return result;
}

// ─── Graph API error classifier ───────────────────────────────────────────────

export function classifyGraphError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof GraphApiError) {
    if (err.code === 190)
      return { status: 401, code: 'TOKEN_EXPIRED', message: 'Your Facebook token has expired. Please reconnect your account.' };
    if (err.code === 10 || err.code === 200)
      return { status: 403, code: 'INSUFFICIENT_PERMISSIONS', message: 'Missing permissions to read Facebook insights. Please reconnect and grant the required permissions.' };
    return { status: 502, code: 'GRAPH_API_ERROR', message: err.message };
  }

  if ((err as { code?: string }).code === 'NO_FACEBOOK_CONNECTION')
    return { status: 404, code: 'NO_FACEBOOK_CONNECTION', message: (err as Error).message };

  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}
