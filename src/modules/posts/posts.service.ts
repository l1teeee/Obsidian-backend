import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';

// ─── Facebook publishing ──────────────────────────────────────────────────────

interface FbConnection extends RowDataPacket {
  access_token:      string;
  user_access_token: string | null;
  page_id:           string;
  page_name:         string | null;
  token_expires_at:  Date | null;
  scopes:            string;
}

async function getFbConnection(userId: string): Promise<FbConnection> {
  const [rows] = await pool.query<FbConnection[]>(
    `SELECT access_token, user_access_token, page_id, page_name, token_expires_at, scopes
     FROM social_connections
     WHERE user_id = ? AND platform = 'facebook' AND page_id IS NOT NULL AND is_active = 1
     LIMIT 1`,
    [userId],
  );
  if (!rows[0]) throw appError('NO_FB_CONNECTION', 'No Facebook page connected. Connect a Facebook account first.', 422);

  const conn = rows[0];

  // If the stored token is a User Token (has expiry), exchange it for a Page Access Token.
  // Page Tokens don't expire and have the permissions needed to post on behalf of the page.
  if (conn.token_expires_at !== null) {
    try {
      const url = `https://graph.facebook.com/v21.0/${conn.page_id}?fields=access_token&access_token=${encodeURIComponent(conn.access_token)}`;
      const res  = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { access_token?: string };
        if (data.access_token) {
          await pool.query(
            `UPDATE social_connections SET access_token = ?, token_expires_at = NULL
             WHERE user_id = ? AND platform = 'facebook' AND page_id = ? AND is_active = 1`,
            [data.access_token, userId, conn.page_id],
          );
          conn.access_token    = data.access_token;
          conn.token_expires_at = null;
        }
      }
    } catch { /* if exchange fails, attempt publish with user token — FB will reject if insufficient */ }
  }

  return conn;
}

interface FbPublishResult { permalink: string; platformPostId: string }

async function buildFbPermalink(graphId: string): Promise<{ permalink: string; platformPostId: string }> {
  const [pageId, postId] = graphId.split('_');
  const permalink = postId
    ? `https://www.facebook.com/${pageId}/posts/${postId}`
    : `https://www.facebook.com/${graphId}`;
  return { permalink, platformPostId: graphId };
}

async function publishToFacebook(userId: string, caption: string, mediaUrls: string[]): Promise<FbPublishResult> {
  const conn = await getFbConnection(userId);

  // Single image: use /photos endpoint (supports caption + url)
  if (mediaUrls.length === 1) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${conn.page_id}/photos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ caption, url: mediaUrls[0], access_token: conn.access_token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message: string } };
      throw appError('FB_PUBLISH_FAILED', body.error?.message ?? `Facebook API error ${res.status}`, 502);
    }
    const data = await res.json() as { id: string; post_id?: string };
    // post_id is the feed post ID (used for metrics); id is the photo object ID
    const graphId = data.post_id ?? data.id;
    return buildFbPermalink(graphId);
  }

  // Multiple images: upload each as unpublished, then attach to feed post
  if (mediaUrls.length > 1) {
    const photoIds: string[] = await Promise.all(
      mediaUrls.map(async (url) => {
        const res = await fetch(`https://graph.facebook.com/v21.0/${conn.page_id}/photos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ url, published: false, access_token: conn.access_token }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: { message: string } };
          throw appError('FB_PUBLISH_FAILED', body.error?.message ?? `Facebook API error ${res.status}`, 502);
        }
        const data = await res.json() as { id: string };
        return data.id;
      }),
    );
    const attached_media = photoIds.map(id => ({ media_fbid: id }));
    const res = await fetch(`https://graph.facebook.com/v21.0/${conn.page_id}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: caption, attached_media, access_token: conn.access_token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message: string } };
      throw appError('FB_PUBLISH_FAILED', body.error?.message ?? `Facebook API error ${res.status}`, 502);
    }
    const data = await res.json() as { id: string };
    return buildFbPermalink(data.id);
  }

  // Text-only post
  const res = await fetch(`https://graph.facebook.com/v21.0/${conn.page_id}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: caption, access_token: conn.access_token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw appError('FB_PUBLISH_FAILED', body.error?.message ?? `Facebook API error ${res.status}`, 502);
  }
  const data = await res.json() as { id: string };
  return buildFbPermalink(data.id);
}

interface PostRow extends RowDataPacket {
  id:               string;
  user_id:          string;
  platform:         'meta' | 'linkedin' | 'youtube' | 'facebook' | 'instagram';
  post_type:        'post' | 'reel' | 'story' | 'video' | 'carousel';
  caption:          string | null;
  media_urls:       string | null;
  permalink:        string | null;
  platform_post_id: string | null;
  status:           'draft' | 'scheduled' | 'published' | 'inactive' | 'deleted';
  scheduled_at:     Date | null;
  published_at:     Date | null;
  created_at:       Date;
  updated_at:       Date;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export interface Post {
  id:               string;
  user_id:          string;
  platform:         string;
  post_type:        string;
  caption:          string | null;
  media_urls:       string[] | null;
  permalink:        string | null;
  platform_post_id: string | null;
  status:           string;
  scheduled_at:     Date | null;
  published_at:     Date | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface GetPostsOptions {
  platform?: string;
  status?:   string;
  page:      number;
  limit:     number;
}

export interface PaginatedPosts {
  posts: Post[];
  meta:  { page: number; limit: number; total: number };
}

export interface CreatePostData {
  platform:     string;
  post_type?:   string;
  caption?:     string;
  media_urls?:  string[];
  scheduled_at?: string;
  status?:      string;
}

export interface UpdatePostData {
  platform?:    string;
  post_type?:   string;
  caption?:     string;
  media_urls?:  string[];
  permalink?:   string;
  scheduled_at?: string;
  published_at?: string;
  status?:      string;
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

function deserializePost(row: PostRow): Post {
  return {
    ...row,
    media_urls: row.media_urls ? (JSON.parse(row.media_urls) as string[]) : null,
  };
}

/** Convert ISO 8601 string (e.g. "2026-03-28T15:15:00.000Z") to MySQL DATETIME format ("2026-03-28 15:15:00") */
function toMysqlDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

async function getById(id: string, userId: string): Promise<Post> {
  const [rows] = await pool.query<PostRow[]>(
    'SELECT * FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  const row = rows[0];
  if (!row) throw appError('NOT_FOUND', 'Post not found', 404);
  return deserializePost(row);
}

export async function getPosts(userId: string, options: GetPostsOptions): Promise<PaginatedPosts> {
  const { platform, status, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['user_id = ?'];
  const params: unknown[]    = [userId];

  if (platform) { conditions.push('platform = ?'); params.push(platform); }
  if (status)   { conditions.push('status = ?');   params.push(status);   }
  else          { conditions.push("status != 'deleted'"); }

  const where = conditions.join(' AND ');

  const [countRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM posts WHERE ${where}`,
    params
  );
  const total = countRows[0]?.total ?? 0;

  const [rows] = await pool.query<PostRow[]>(
    `SELECT * FROM posts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { posts: rows.map(deserializePost), meta: { page, limit, total } };
}

export async function getPostById(id: string, userId: string): Promise<Post> {
  return getById(id, userId);
}

export async function createPost(userId: string, data: CreatePostData): Promise<Post> {
  const id            = uid();
  const mediaUrlsJson = data.media_urls ? JSON.stringify(data.media_urls) : null;
  const status        = data.status ?? 'draft';

  await pool.query<ResultSetHeader>(
    `INSERT INTO posts (id, user_id, platform, post_type, caption, media_urls, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      data.platform,
      data.post_type   ?? 'post',
      data.caption     ?? null,
      mediaUrlsJson,
      data.scheduled_at ? toMysqlDatetime(data.scheduled_at) : null,
      status,
    ]
  );

  // Publish immediately to Facebook if requested
  if (status === 'published' && data.platform === 'facebook') {
    const result = await publishToFacebook(userId, data.caption ?? '', data.media_urls ?? []);
    await pool.query(
      `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
      [result.permalink, result.platformPostId, id],
    );
  }

  return getById(id, userId);
}

export async function updatePost(id: string, userId: string, data: UpdatePostData): Promise<Post> {
  const fields: string[]  = [];
  const values: unknown[] = [];

  if (data.platform     !== undefined) { fields.push('platform = ?');     values.push(data.platform);     }
  if (data.post_type    !== undefined) { fields.push('post_type = ?');    values.push(data.post_type);    }
  if (data.caption      !== undefined) { fields.push('caption = ?');      values.push(data.caption);      }
  if (data.media_urls   !== undefined) { fields.push('media_urls = ?');   values.push(JSON.stringify(data.media_urls)); }
  if (data.permalink    !== undefined) { fields.push('permalink = ?');    values.push(data.permalink);    }
  if (data.scheduled_at !== undefined) { fields.push('scheduled_at = ?'); values.push(data.scheduled_at ? toMysqlDatetime(data.scheduled_at) : null); }
  if (data.published_at !== undefined) { fields.push('published_at = ?'); values.push(data.published_at); }
  if (data.status       !== undefined) { fields.push('status = ?');       values.push(data.status);       }

  if (fields.length === 0) return getById(id, userId);

  const [check] = await pool.query<PostRow[]>(
    'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  if (check.length === 0) throw appError('NOT_FOUND', 'Post not found', 404);

  values.push(id, userId);
  await pool.query(
    `UPDATE posts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    values
  );

  // Publish to Facebook if the status is being set to published
  if (data.status === 'published') {
    const post = await getById(id, userId);
    const effectivePlatform = data.platform ?? post.platform;
    if (effectivePlatform === 'facebook' && !post.permalink) {
      const mediaUrls = data.media_urls ?? (post.media_urls ?? []);
      const caption   = data.caption   ?? post.caption ?? '';
      const result    = await publishToFacebook(userId, caption, mediaUrls);
      await pool.query(
        `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
        [result.permalink, result.platformPostId, id],
      );
    }
  }

  return getById(id, userId);
}

export async function deactivatePost(id: string, userId: string): Promise<Post> {
  const [check] = await pool.query<PostRow[]>(
    'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  if (check.length === 0) throw appError('NOT_FOUND', 'Post not found', 404);
  await pool.query(
    "UPDATE posts SET status = 'inactive' WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return getById(id, userId);
}

export async function deletePost(id: string, userId: string): Promise<void> {
  const [check] = await pool.query<PostRow[]>(
    'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  if (check.length === 0) throw appError('NOT_FOUND', 'Post not found', 404);
  await pool.query(
    "UPDATE posts SET status = 'deleted' WHERE id = ? AND user_id = ?",
    [id, userId]
  );
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface PostMetrics {
  likes:       number;
  comments:    number;
  shares:      number;
  reach:       number | null;
  impressions: number | null;
  clicks:      number | null;
  dev_mode:    boolean;
}

export async function getPostMetrics(postId: string, userId: string): Promise<PostMetrics> {
  const post = await getById(postId, userId);

  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (post.platform !== 'facebook' || !post.platform_post_id) {
    return { likes: 0, comments: 0, shares: 0, reach: null, impressions: null, clicks: null, dev_mode: isDevelopment };
  }

  // In development mode skip Graph API calls — permissions aren't fully active
  if (isDevelopment) {
    return { likes: 0, comments: 0, shares: 0, reach: null, impressions: null, clicks: null, dev_mode: true };
  }

  const conn    = await getFbConnection(userId);
  const token   = conn.access_token;
  const graphId = post.platform_post_id;

  // ── Engagement: reactions, comments, shares ───────────────────────────────
  const engUrl = new URL(`https://graph.facebook.com/v21.0/${graphId}`);
  engUrl.searchParams.set('fields', 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares');
  engUrl.searchParams.set('access_token', token);

  let likes    = 0;
  let comments = 0;
  let shares   = 0;

  try {
    const engRes = await fetch(engUrl.toString());
    if (engRes.ok) {
      const eng = await engRes.json() as {
        reactions?: { summary: { total_count: number } };
        comments?:  { summary: { total_count: number } };
        shares?:    { count: number };
      };
      likes    = eng.reactions?.summary?.total_count ?? 0;
      comments = eng.comments?.summary?.total_count  ?? 0;
      shares   = eng.shares?.count                   ?? 0;
    } else {
      const body = await engRes.json().catch(() => ({}));
      console.warn('[METRICS] engagement failed:', engRes.status, body);
    }
  } catch (e) { console.warn('[METRICS] engagement error:', e); }

  // ── Insights: impressions, clicks ────────────────────────────────────────
  let impressions: number | null = null;
  let clicks:      number | null = null;

  try {
    const insightsUrl = new URL(`https://graph.facebook.com/v21.0/${graphId}/insights`);
    insightsUrl.searchParams.set('metric', 'post_impressions,post_clicks');
    insightsUrl.searchParams.set('period', 'lifetime');
    insightsUrl.searchParams.set('access_token', token);

    const insRes = await fetch(insightsUrl.toString());
    if (insRes.ok) {
      const ins = await insRes.json() as { data?: { name: string; values: { value: number }[] }[] };
      for (const item of ins.data ?? []) {
        const val = item.values?.[0]?.value ?? 0;
        if (item.name === 'post_impressions') impressions = val;
        if (item.name === 'post_clicks')      clicks      = val;
      }
    } else {
      const body = await insRes.json().catch(() => ({}));
      console.warn('[METRICS] insights failed:', insRes.status, body);
    }
  } catch (e) { console.warn('[METRICS] insights error:', e); }

  return { likes, comments, shares, reach: null, impressions, clicks, dev_mode: false };
}
