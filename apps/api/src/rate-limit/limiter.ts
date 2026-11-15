/**
 * In-process token-bucket limiter with a hard cap on memory.
 * Pure data + functions: no classes, no timers, injectable clock (easy to test deterministically).
 *
 * Memory safety: buckets live in an insertion-ordered Map used as an LRU. When more than `maxKeys`
 * distinct keys exist, the least recently used are dropped, so an attacker rotating keys cannot make
 * the process grow without bound.
 */
export type Decision = { allowed: boolean; retryAfterSec: number; remaining: number };

export type Limiter = {
  take: (key: string) => Decision;
  size: () => number;
};

export type LimiterOptions = {
  /** Burst size: tokens a fresh key starts with. */
  capacity: number;
  refillPerSec: number;
  maxKeys: number;
  now?: () => number;
};

type Bucket = { tokens: number; at: number };

export const createLimiter = (options: LimiterOptions): Limiter => {
  const { capacity, refillPerSec, maxKeys } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const take = (key: string): Decision => {
    const t = now();
    const existing = buckets.get(key);
    let bucket: Bucket;
    if (existing) {
      buckets.delete(key); // re-inserted below → moves to the "most recent" end
      const elapsedSec = Math.max(0, t - existing.at) / 1000; // a clock jumping back never refunds
      bucket = { tokens: Math.min(capacity, existing.tokens + elapsedSec * refillPerSec), at: t };
    } else {
      bucket = { tokens: capacity, at: t };
    }
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    buckets.set(key, bucket);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done) break;
      buckets.delete(oldest.value);
    }
    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec)),
      remaining: Math.floor(bucket.tokens),
    };
  };

  return { take, size: () => buckets.size };
};

/** A limiter that never says no (RATE_LIMIT_ENABLED=false). */
export const unlimited: Limiter = {
  take: () => ({ allowed: true, retryAfterSec: 0, remaining: Number.MAX_SAFE_INTEGER }),
  size: () => 0,
};
