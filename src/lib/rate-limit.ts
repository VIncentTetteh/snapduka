/**
 * Postgres-backed sliding-window rate limiter.
 *
 * Backed by a `rate_limit_counters` table + `check_rate_limit` RPC, so
 * counters are shared across every serverless instance — the prior
 * in-memory Map reset per Vercel instance under concurrent load, making
 * every limit in the app (OTP, checkout, Paystack, analytics, restock)
 * trivially bypassable by a deliberate attacker.
 */

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
 *
 * Fails open on a database error — a transient RPC failure must not turn
 * into a full outage of login/checkout for every legitimate user.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitConfig,
): Promise<RateLimitResult> {
  // Lazy import: the admin client pulls in `server-only`, which client-adjacent
  // test files can't load at module scope.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
  if (error || !data || data.length === 0) {
    return { ok: true };
  }
  const [{ allowed, retry_after_ms }] = data;
  return allowed ? { ok: true } : { ok: false, retryAfterMs: Number(retry_after_ms) };
}

/**
 * Hand back one unit of quota that `checkRateLimit` consumed for work that
 * provably did not happen — a provider that failed to send, not a caller that
 * got something wrong.
 *
 * The increment stays where it is, before the work, because splitting it into
 * check-then-increment is racy: two concurrent requests would both pass. This
 * refund keeps that atomic guarantee while making a failed send free, so a
 * provider outage cannot lock a user out of their own account.
 *
 * Best-effort by design. If the refund fails the caller simply keeps a limit
 * that is stricter than intended, which is the safe direction to fail.
 */
export async function releaseRateLimit(key: string): Promise<void> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  await admin.rpc("release_rate_limit", { p_key: key });
}
