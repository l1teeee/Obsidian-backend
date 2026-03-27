import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';

interface PostRow extends RowDataPacket {
  id:           string;
  user_id:      string;
  platform:     'meta' | 'linkedin' | 'youtube';
  post_type:    'post' | 'reel' | 'story' | 'video' | 'carousel';
  caption:      string | null;
  media_urls:   string | null;
  permalink:    string | null;
  status:       'draft' | 'scheduled' | 'published' | 'inactive' | 'deleted';
  scheduled_at: Date | null;
  published_at: Date | null;
  created_at:   Date;
  updated_at:   Date;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export interface Post {
  id:           string;
  user_id:      string;
  platform:     string;
  post_type:    string;
  caption:      string | null;
  media_urls:   string[] | null;
  permalink:    string | null;
  status:       string;
  scheduled_at: Date | null;
  published_at: Date | null;
  created_at:   Date;
  updated_at:   Date;
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
  const id           = uid();
  const mediaUrlsJson = data.media_urls ? JSON.stringify(data.media_urls) : null;

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
      data.scheduled_at ?? null,
      data.status      ?? 'draft',
    ]
  );

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
  if (data.scheduled_at !== undefined) { fields.push('scheduled_at = ?'); values.push(data.scheduled_at); }
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
