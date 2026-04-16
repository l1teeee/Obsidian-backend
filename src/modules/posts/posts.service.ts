import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool }           from '../../config/db';
import { uid }            from '../../lib/uid';
import { decryptToken }   from '../../lib/crypto';
import { S3_PUBLIC_URL }  from '../../lib/s3';
import { promoteToPost, deleteS3Objects } from '../media/media.service';
import { sendPostCreatedEmail } from '../../lib/email';

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
  conn.access_token = decryptToken(conn.access_token);

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

// Extract Facebook Graph post ID (pageId_postId) from a stored permalink.
// Supports two formats:
//   https://www.facebook.com/{pageId}/posts/{postId}
//   https://www.facebook.com/permalink.php?story_fbid={postId}&id={pageId}
function extractGraphIdFromPermalink(permalink: string | null): string | null {
  if (!permalink) return null;
  try {
    const url = new URL(permalink);
    // Format: /pageId/posts/postId
    const pathMatch = url.pathname.match(/^\/(\d+)\/posts\/(\d+)/);
    if (pathMatch) return `${pathMatch[1]}_${pathMatch[2]}`;
    // Format: ?story_fbid=postId&id=pageId
    const storyFbid = url.searchParams.get('story_fbid');
    const pageId    = url.searchParams.get('id');
    if (storyFbid && pageId) return `${pageId}_${storyFbid}`;
    return null;
  } catch {
    return null;
  }
}

async function buildFbPermalink(graphId: string): Promise<{ permalink: string; platformPostId: string }> {
  const [pageId, postId] = graphId.split('_');
  const permalink = postId
    ? `https://www.facebook.com/${pageId}/posts/${postId}`
    : `https://www.facebook.com/${graphId}`;
  return { permalink, platformPostId: graphId };
}

/** True when a URL points to a video file (by extension). */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|avi)(\?|$)/i.test(url);
}

async function publishToFacebook(userId: string, caption: string, mediaUrls: string[]): Promise<FbPublishResult> {
  const conn = await getFbConnection(userId);

  // Single video: use /videos endpoint (file_url + description)
  if (mediaUrls.length === 1 && isVideoUrl(mediaUrls[0])) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${conn.page_id}/videos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file_url: mediaUrls[0], description: caption, access_token: conn.access_token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message: string } };
      throw appError('FB_PUBLISH_FAILED', body.error?.message ?? `Facebook API error ${res.status}`, 502);
    }
    const data = await res.json() as { id: string };
    return buildFbPermalink(data.id);
  }

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

// ─── Instagram publishing ─────────────────────────────────────────────────────

interface IgConnectionRow extends RowDataPacket {
  ig_user_id: string;
  page_token: string;
}

async function getIgConnection(userId: string): Promise<IgConnectionRow> {
  const [rows] = await pool.query<IgConnectionRow[]>(
    `SELECT ig_business_id AS ig_user_id, access_token AS page_token
     FROM social_connections
     WHERE user_id = ? AND platform = 'facebook' AND ig_business_id IS NOT NULL AND is_active = 1
     LIMIT 1`,
    [userId],
  );
  if (!rows[0]) {
    throw appError(
      'NO_IG_CONNECTION',
      'No Instagram Business account connected. Connect an Instagram Business account via Facebook first.',
      422,
    );
  }
  const conn = rows[0];
  conn.page_token = decryptToken(conn.page_token);
  return conn;
}

/** Poll /{creationId}?fields=status_code until FINISHED or error/timeout. */
async function pollIgReady(creationId: string, token: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    if (res.ok) {
      const { status_code } = await res.json() as { status_code?: string };
      if (status_code === 'FINISHED') return;
      if (status_code === 'ERROR') throw appError('IG_PUBLISH_FAILED', 'Instagram media processing failed', 502);
    }
  }
  throw appError('IG_PUBLISH_TIMEOUT', 'Instagram media processing timed out after 60 seconds', 504);
}

async function igMediaPublish(igUserId: string, token: string, creationId: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw appError('IG_PUBLISH_FAILED', body.error?.message ?? `Instagram publish error ${res.status}`, 502);
  }
  const { id } = await res.json() as { id: string };
  return id; // IG media ID
}

async function getIgPermalink(mediaId: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
    );
    if (res.ok) {
      const data = await res.json() as { permalink?: string };
      if (data.permalink) return data.permalink;
    }
  } catch { /* fallback below */ }
  return `https://www.instagram.com/`;
}

interface IgPublishResult { permalink: string; platformPostId: string }

async function publishToInstagram(
  userId:    string,
  caption:   string,
  mediaUrls: string[],
  postType:  string,
): Promise<IgPublishResult> {
  if (!mediaUrls.length) {
    throw appError('IG_NO_MEDIA', 'Instagram requires at least one image or video.', 422);
  }

  const conn     = await getIgConnection(userId);
  const igUserId = conn.ig_user_id;
  const token    = conn.page_token;

  // ── Single image ──────────────────────────────────────────────────────────
  if (mediaUrls.length === 1 && !isVideoUrl(mediaUrls[0])) {
    const containerRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image_url: mediaUrls[0], caption, access_token: token }),
    });
    if (!containerRes.ok) {
      const body = await containerRes.json().catch(() => ({})) as { error?: { message: string } };
      throw appError('IG_PUBLISH_FAILED', body.error?.message ?? `Instagram API error ${containerRes.status}`, 502);
    }
    const { id: creationId } = await containerRes.json() as { id: string };
    const mediaId = await igMediaPublish(igUserId, token, creationId);
    const permalink = await getIgPermalink(mediaId, token);
    return { permalink, platformPostId: mediaId };
  }

  // ── Single video / reel ───────────────────────────────────────────────────
  if (mediaUrls.length === 1 && isVideoUrl(mediaUrls[0])) {
    const mediaType = postType === 'story' ? 'STORIES' : 'REELS';
    const containerRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ video_url: mediaUrls[0], media_type: mediaType, caption, access_token: token }),
    });
    if (!containerRes.ok) {
      const body = await containerRes.json().catch(() => ({})) as { error?: { message: string } };
      throw appError('IG_PUBLISH_FAILED', body.error?.message ?? `Instagram API error ${containerRes.status}`, 502);
    }
    const { id: creationId } = await containerRes.json() as { id: string };
    // Videos require async processing — poll until ready
    await pollIgReady(creationId, token);
    const mediaId = await igMediaPublish(igUserId, token, creationId);
    const permalink = await getIgPermalink(mediaId, token);
    return { permalink, platformPostId: mediaId };
  }

  // ── Carousel (2–10 items, images and/or videos) ───────────────────────────
  const itemIds = await Promise.all(
    mediaUrls.map(async (url) => {
      const body: Record<string, string | boolean> = { is_carousel_item: true, access_token: token };
      if (isVideoUrl(url)) {
        body.video_url  = url;
        body.media_type = 'VIDEO';
      } else {
        body.image_url = url;
      }
      const res = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message: string } };
        throw appError('IG_PUBLISH_FAILED', err.error?.message ?? `Instagram carousel item error ${res.status}`, 502);
      }
      const { id } = await res.json() as { id: string };
      // Poll video carousel items until processing finishes
      if (isVideoUrl(url)) await pollIgReady(id, token);
      return id;
    }),
  );

  const carouselRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      media_type:   'CAROUSEL',
      caption,
      children:     itemIds.join(','),
      access_token: token,
    }),
  });
  if (!carouselRes.ok) {
    const body = await carouselRes.json().catch(() => ({})) as { error?: { message: string } };
    throw appError('IG_PUBLISH_FAILED', body.error?.message ?? `Instagram carousel container error ${carouselRes.status}`, 502);
  }
  const { id: carouselId } = await carouselRes.json() as { id: string };
  const mediaId = await igMediaPublish(igUserId, token, carouselId);
  const permalink = await getIgPermalink(mediaId, token);
  return { permalink, platformPostId: mediaId };
}

// ─── S3 temp → posts promotion ───────────────────────────────────────────────

/**
 * For any URL pointing to the temp/ prefix in S3, copy it to posts/ (permanent).
 * URLs already in media/ or posts/ are returned unchanged.
 */
async function promoteMediaUrls(urls: string[], postId: string, userId: string): Promise<string[]> {
  const base       = S3_PUBLIC_URL.replace(/\/$/, '');
  const tempPrefix = `${base}/temp/`;
  return Promise.all(
    urls.map(async (url) => {
      if (!url.startsWith(tempPrefix)) return url;
      const key = url.slice(base.length + 1); // 'temp/userId/uuid.ext'
      try {
        return await promoteToPost(key, postId, userId);
      } catch {
        return url; // keep temp URL on failure — will auto-expire in 7 days
      }
    }),
  );
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

  // Always promote temp/ S3 objects on first save (draft, scheduled, or published).
  // This prevents temp/ URLs from expiring before the post is ever published.
  let finalMediaUrls = data.media_urls ?? [];
  if (finalMediaUrls.length) {
    finalMediaUrls = await promoteMediaUrls(finalMediaUrls, id, userId);
    await pool.query(
      'UPDATE posts SET media_urls = ? WHERE id = ?',
      [JSON.stringify(finalMediaUrls), id],
    );
  }

  // Publish immediately to Facebook if requested
  if (status === 'published' && data.platform === 'facebook') {
    const result = await publishToFacebook(userId, data.caption ?? '', finalMediaUrls);
    await pool.query(
      `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
      [result.permalink, result.platformPostId, id],
    );
  }

  // Publish immediately to Instagram if requested
  if (status === 'published' && data.platform === 'instagram') {
    const result = await publishToInstagram(userId, data.caption ?? '', finalMediaUrls, data.post_type ?? 'post');
    await pool.query(
      `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
      [result.permalink, result.platformPostId, id],
    );
  }

  const post = await getById(id, userId);

  // Fire-and-forget email
  const [userRows] = await pool.query<(RowDataPacket & { email: string; name: string | null })[]>(
    'SELECT email, name FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (userRows[0]) {
    const scheduledLabel = data.scheduled_at
      ? new Date(data.scheduled_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
      : undefined;
    sendPostCreatedEmail(userRows[0].email, {
      name:        userRows[0].name ?? undefined,
      platform:    data.platform ?? 'unknown',
      status:      status,
      caption:     data.caption ?? undefined,
      scheduledAt: scheduledLabel,
    });
  }

  return post;
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

  // Fetch current post — validates ownership and provides old media_urls for cleanup
  const current = await getById(id, userId);

  if (fields.length === 0) return current;

  // Delete S3 files that are being removed from the post
  if (data.media_urls !== undefined) {
    const incomingSet = new Set(data.media_urls);
    const orphaned    = (current.media_urls ?? []).filter(url => !incomingSet.has(url));
    if (orphaned.length) await deleteS3Objects(orphaned);
  }

  values.push(id, userId);
  await pool.query(
    `UPDATE posts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    values
  );

  // Publish to platform if the status is being set to published
  if (data.status === 'published') {
    const post            = await getById(id, userId);
    const effectivePlatform = data.platform ?? post.platform;

    if (!post.permalink) {
      let rawMediaUrls = data.media_urls ?? (post.media_urls ?? []);
      // Promote temp/ S3 objects to permanent posts/ path
      if (rawMediaUrls.length) {
        rawMediaUrls = await promoteMediaUrls(rawMediaUrls, id, userId);
        await pool.query(
          'UPDATE posts SET media_urls = ? WHERE id = ?',
          [JSON.stringify(rawMediaUrls), id],
        );
      }

      const caption = data.caption ?? post.caption ?? '';

      if (effectivePlatform === 'facebook') {
        const result = await publishToFacebook(userId, caption, rawMediaUrls);
        await pool.query(
          `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
          [result.permalink, result.platformPostId, id],
        );
      } else if (effectivePlatform === 'instagram') {
        const postType = data.post_type ?? post.post_type;
        const result   = await publishToInstagram(userId, caption, rawMediaUrls, postType);
        await pool.query(
          `UPDATE posts SET permalink = ?, platform_post_id = ?, published_at = NOW() WHERE id = ?`,
          [result.permalink, result.platformPostId, id],
        );
      }
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

export async function deletePost(id: string, userId: string, removeFromPlatform = false): Promise<{ fbDeleteFailed?: boolean }> {
  const post = await getById(id, userId);

  let fbDeleteFailed = false;

  // Optionally remove from Facebook before marking deleted in DB
  if (removeFromPlatform && post.platform === 'facebook' && post.platform_post_id) {
    try {
      const conn = await getFbConnection(userId);
      const url  = new URL(`https://graph.facebook.com/v21.0/${post.platform_post_id}`);
      url.searchParams.set('access_token', conn.access_token);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('[DELETE] Facebook delete failed:', res.status, body);
        fbDeleteFailed = true;
      }
    } catch (e) {
      console.warn('[DELETE] Facebook delete error:', e);
      fbDeleteFailed = true;
    }
  }

  await pool.query(
    "UPDATE posts SET status = 'deleted' WHERE id = ? AND user_id = ?",
    [id, userId],
  );

  // Clean up all S3 files associated with this post
  if (post.media_urls?.length) {
    await deleteS3Objects(post.media_urls);
  }

  return fbDeleteFailed ? { fbDeleteFailed: true } : {};
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

  if (post.platform !== 'facebook') {
    return { likes: 0, comments: 0, shares: 0, reach: null, impressions: null, clicks: null, dev_mode: isDevelopment };
  }

  // Resolve graphId: use stored platform_post_id, or extract from permalink as fallback
  let graphId = post.platform_post_id ?? extractGraphIdFromPermalink(post.permalink);

  if (!graphId) {
    return { likes: 0, comments: 0, shares: 0, reach: null, impressions: null, clicks: null, dev_mode: isDevelopment };
  }

  // In development mode skip Graph API calls — permissions aren't fully active
  if (isDevelopment) {
    return { likes: 0, comments: 0, shares: 0, reach: null, impressions: null, clicks: null, dev_mode: true };
  }

  const conn  = await getFbConnection(userId);
  const token = conn.access_token;

  // Use insights-based fields — same approach as metrics.service.ts which works
  // with read_insights permission (no pages_read_engagement required).
  // reactions.summary() and comments.summary() require pages_read_engagement
  // which is not yet approved by Meta.
  const fields = [
    'insights.metric(post_reactions_by_type_total,post_clicks,post_media_view,post_total_media_view_unique)',
  ].join(',');

  const url = new URL(`https://graph.facebook.com/v21.0/${graphId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', token);

  let likes        = 0;
  let impressions: number | null = null;
  let reach:       number | null = null;
  let clicks:      number | null = null;

  try {
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json() as {
        insights?: { data: { name: string; values: { value: number | Record<string, number> }[] }[] };
      };
      for (const item of json.insights?.data ?? []) {
        const raw = item.values?.[0]?.value ?? 0;
        const num = typeof raw === 'object' ? Object.values(raw).reduce((a, b) => a + b, 0) : (raw as number);
        if (item.name === 'post_reactions_by_type_total') likes        = num;
        if (item.name === 'post_clicks')                  clicks       = num;
        if (item.name === 'post_media_view')              impressions  = num;
        if (item.name === 'post_total_media_view_unique') reach        = num;
      }
    } else {
      const body = await res.json().catch(() => ({}));
      console.warn('[METRICS] post fetch failed:', res.status, body);
    }
  } catch (e) { console.warn('[METRICS] post fetch error:', e); }

  return { likes, comments: 0, shares: 0, reach, impressions, clicks, dev_mode: false };
}
