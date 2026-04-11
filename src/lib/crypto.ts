import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env';

// ─── AES-256-GCM token encryption ─────────────────────────────────────────────
// Format: "enc:" + base64(iv[12] + authTag[16] + ciphertext)
// The "enc:" prefix allows backward-compatible decryption of legacy plaintext tokens.

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16;   // 128-bit authentication tag

export function encryptToken(plaintext: string): string {
  const key       = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');
  const iv        = randomBytes(IV_BYTES);
  const cipher    = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // iv + tag + ciphertext → base64, prefixed so we can detect encrypted rows
  return 'enc:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a token that was encrypted with encryptToken().
 * If the value does not start with "enc:" it is returned as-is — this
 * provides backward compatibility for rows that were stored before encryption
 * was introduced and is safe because the "enc:" prefix is not a valid start
 * for any Facebook/Instagram access token.
 */
export function decryptToken(ciphertext: string): string {
  if (!ciphertext.startsWith('enc:')) {
    // Legacy plaintext token — return unchanged
    return ciphertext;
  }

  const key  = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');
  const data = Buffer.from(ciphertext.slice(4), 'base64');

  const iv        = data.subarray(0, IV_BYTES);
  const tag       = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = data.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
