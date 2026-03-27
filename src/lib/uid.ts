import { randomBytes } from 'crypto';

/**
 * Generates a 16-character URL-safe unique ID.
 * Uses 12 random bytes encoded as base64url → 16 chars, 2^96 combinations.
 * No external dependencies, no sequential enumeration risk.
 */
export function uid(): string {
  return randomBytes(12).toString('base64url');
}
