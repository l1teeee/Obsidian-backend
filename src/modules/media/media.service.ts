import { randomUUID } from 'crypto';

export interface UploadResult {
  url:      string;
  filename: string;
  size:     number;
  mimeType: string;
}

/**
 * ─── STORAGE ADAPTER ────────────────────────────────────────────────────────
 *
 * This is the ONLY function to replace when connecting real storage (S3, R2, etc).
 * Contract: receives a buffer + metadata, returns a public URL.
 * Everything else (routing, validation, auth) stays unchanged.
 */
export async function storeFile(
  buffer:   Buffer,
  filename: string,
  mimeType: string,
): Promise<UploadResult> {
  // ── Simulate async upload latency ──────────────────────────────────────────
  // Remove this block when replacing with real storage.
  await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200));

  // ── TODO: replace block below with real storage call ──────────────────────
  // Example for S3/R2:
  //   await s3Client.send(new PutObjectCommand({
  //     Bucket: env.R2_BUCKET,
  //     Key:    `media/${id}/${safeFilename}`,
  //     Body:   buffer,
  //     ContentType: mimeType,
  //   }));
  //   return { url: `${env.R2_PUBLIC_URL}/media/${id}/${safeFilename}`, ... };
  // ──────────────────────────────────────────────────────────────────────────

  const id          = randomUUID();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const url         = `https://media.placeholder.dev/${id}/${safeFilename}`;

  return { url, filename: safeFilename, size: buffer.length, mimeType };
}
