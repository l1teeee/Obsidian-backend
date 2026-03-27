import { FastifyRequest, FastifyReply } from 'fastify';
import { storeFile } from './media.service';

const MAX_FILE_SIZE = 100 * 1024 * 1024;  // 100 MB

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

/**
 * Detect actual MIME type from the first bytes of the buffer (magic bytes).
 * Returns null if the file format is not recognised as a safe image/video.
 */
function detectMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x41 && buf[11] === 0x50) return 'image/webp';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp';

  // MP4: ftyp box at offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  // QuickTime MOV: moov box at offset 4
  if (buf[4] === 0x6D && buf[5] === 0x6F && buf[6] === 0x6F && buf[7] === 0x76) return 'video/quicktime';
  // WEBM / MKV: 1A 45 DF A3
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';
  // AVI: RIFF....AVI
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49) return 'video/avi';

  return null;
}

export async function uploadHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE } });

  if (!file) {
    throw appError('NO_FILE', 'No file provided.', 400);
  }

  // Read into buffer first — enforces the size limit set above
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw appError('FILE_TOO_LARGE', 'File exceeds the 100 MB limit.', 413);
    }
    throw err;
  }

  // Validate actual file content via magic bytes — ignore client-supplied Content-Type
  const actualMime = detectMime(buffer);
  if (!actualMime) {
    throw appError('INVALID_TYPE', 'Only image and video files are allowed.', 415);
  }

  const result = await storeFile(buffer, file.filename, actualMime);

  reply.code(200).send({ success: true, data: result });
}
