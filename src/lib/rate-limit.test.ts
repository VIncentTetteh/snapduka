import { afterEach, describe, expect, it } from "vitest";

import { _resetRateLimitStore, checkRateLimit } from "./rate-limit";

afterEach(() => _resetRateLimitStore());

describe("checkRateLimit", () => {
  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("test-key", { limit: 5, windowMs: 60_000 })).toEqual({ ok: true });
    }
  });

  it("blocks once the limit is exceeded", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    }
    const result = checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("isolates counters by key", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("key-a", { limit: 5, windowMs: 60_000 });
    }
    // key-b is a fresh counter — must be allowed
    expect(checkRateLimit("key-b", { limit: 5, windowMs: 60_000 })).toEqual({ ok: true });
  });

  it("resets the window after it expires", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-key", { limit: 5, windowMs: 1 });
    }
    // Limit hit
    expect(checkRateLimit("test-key", { limit: 5, windowMs: 1 }).ok).toBe(false);

    // After 1 ms the window has expired — next call opens a new window
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit("test-key", { limit: 5, windowMs: 1 })).toEqual({ ok: true });
        resolve();
      }, 5);
    });
  });

  it("returns ok:true for the very first request on any key", () => {
    expect(checkRateLimit("brand-new-key", { limit: 1, windowMs: 60_000 })).toEqual({ ok: true });
  });

  it("blocks on the second request when limit is 1", () => {
    checkRateLimit("strict", { limit: 1, windowMs: 60_000 });
    const result = checkRateLimit("strict", { limit: 1, windowMs: 60_000 });
    expect(result.ok).toBe(false);
  });
});
