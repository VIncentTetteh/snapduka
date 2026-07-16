/**
 * In-memory sliding-window rate limiter.
 *
 * Single-process only. Swap `store` for a Redis/Upstash client to make
 * this work across multiple serverless instances in production.
 */

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

export type RateLimitConfig = {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

/**
 * Check and increment the rate-limit counter for `key`.
 * Returns `{ ok: true }` when the request is allowed,
 * or `{ ok: false, retryAfterMs }` when the limit is exceeded.
 */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // Window expired or no prior entry — start a fresh window.
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= limit) {
    return { ok: false, retryAfterMs: entry.resetAt - now };
  }

  store.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
  return { ok: true };
}

/** Remove all entries — intended for use in tests only. */
export function _resetRateLimitStore(): void {
  store.clear();
}
