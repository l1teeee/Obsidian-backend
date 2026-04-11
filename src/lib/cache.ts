/**
 * Simple in-memory TTL cache.
 * Single-instance Node.js — no Redis needed at this scale.
 * Swap the TtlCache implementation for a Redis adapter when horizontal scaling is needed.
 */

interface Entry<T> {
  value:     T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Delete all keys that start with the given prefix. */
  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Remove expired entries (call periodically if memory is a concern). */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

export const cache = new TtlCache();

// Prune expired entries every 10 minutes
setInterval(() => cache.prune(), 10 * 60 * 1000).unref();

// ── TTL constants ─────────────────────────────────────────────────────────────
export const TTL = {
  FIVE_MIN:    5  * 60 * 1000,
  FIFTEEN_MIN: 15 * 60 * 1000,
  THIRTY_MIN:  30 * 60 * 1000,
} as const;
