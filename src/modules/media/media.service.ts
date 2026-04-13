import { randomUUID } from 'crypto';
import { PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3, S3_BUCKET, S3_PUBLIC_URL } from '../../lib/s3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UploadResult {
  url:      string;
  key:      string;
  filename: string;
  size:     number;
  mimeType: string;
}

export interface PresignResult {
  presignedUrl: string;
  key:          string;
  publicUrl:    string;  // public S3 URL — use this as sourceUrl after upload
  expiresIn:    number;  // seconds
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/gif':       'gif',
  'image/webp':      'webp',
  'image/bmp':       'bmp',
  'video/mp4':       'mp4',
  'video/quicktime': 'mov',
  'video/webm':      'webm',
  'video/avi':       'avi',
};

function getExt(mimeType: string): string {
  return EXT_MAP[mimeType] ?? 'bin';
}

// ─── Storage functions ────────────────────────────────────────────────────────

/**
 * Server-side upload: backend receives the file buffer and uploads it to S3.
 * Used for images via POST /media/upload and AI-generated images.
 *
 * Bucket key: temp/{userId}/{uuid}.{ext}
 * Using temp/ ensures the lifecycle rule (7 days) cleans up files from abandoned
 * composers automatically. promoteMediaUrls() moves them to posts/ on first save.
 */
export async function storeFile(
  buffer:   Buffer,
  filename: string,
  mimeType: string,
  userId:   string,
): Promise<UploadResult> {
  const id   = randomUUID();
  const ext  = getExt(mimeType);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key  = `temp/${userId}/${id}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:             S3_BUCKET,
    Key:                key,
    Body:               buffer,
    ContentType:        mimeType,
    ContentDisposition: `inline; filename="${safe}"`,
  }));

  return {
    url:      `${S3_PUBLIC_URL}/${key}`,
    key,
    filename: safe,
    size:     buffer.length,
    mimeType,
  };
}

/**
 * Returns a pre-signed PUT URL so the browser uploads the file DIRECTLY to S3.
 * The backend is never in the data path — ideal for large videos.
 *
 * Bucket key: temp/{userId}/{uuid}.{ext}
 * The temp/ prefix has a lifecycle rule that auto-deletes objects after 7 days,
 * cleaning up abandoned drafts automatically.
 *
 * The client must:
 *   PUT {presignedUrl}
 *   Headers: Content-Type: {mimeType}
 *   Body: raw file binary
 */
export async function getPresignedUploadUrl(
  userId:   string,
  mimeType: string,
): Promise<PresignResult> {
  const id  = randomUUID();
  const ext = getExt(mimeType);
  const key = `temp/${userId}/${id}.${ext}`;

  const EXPIRES_IN = 3600; // 1 hour

  const presignedUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket:      S3_BUCKET,
      Key:         key,
      ContentType: mimeType,
    }),
    { expiresIn: EXPIRES_IN },
  );

  return { presignedUrl, key, publicUrl: `${S3_PUBLIC_URL}/${key}`, expiresIn: EXPIRES_IN };
}

/**
 * Deletes S3 objects by their public URLs.
 * Silently ignores URLs that don't belong to this bucket or that are already gone.
 */
export async function deleteS3Objects(urls: string[]): Promise<void> {
  const base = S3_PUBLIC_URL.replace(/\/$/, '');
  const keys = urls
    .filter(url => url.startsWith(`${base}/`))
    .map(url => url.slice(base.length + 1));

  await Promise.all(
    keys.map(key =>
      s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => {}),
    ),
  );
}

/**
 * Moves a media file from temp/ to posts/ when a post is published.
 * Called from posts.service when a post transitions to 'published'.
 *
 * Returns the permanent public URL.
 */
export async function promoteToPost(
  tempKey: string,
  postId:  string,
  userId:  string,
): Promise<string> {
  const ext     = tempKey.split('.').pop() ?? 'bin';
  const destKey = `posts/${userId}/${postId}/${randomUUID()}.${ext}`;

  await s3.send(new CopyObjectCommand({
    Bucket:     S3_BUCKET,
    CopySource: `${S3_BUCKET}/${tempKey}`,
    Key:        destKey,
  }));

  return `${S3_PUBLIC_URL}/${destKey}`;
}
