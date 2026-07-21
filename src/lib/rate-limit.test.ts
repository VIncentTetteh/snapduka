import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls check_rate_limit with the key, limit, and window", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_ms: 0 }], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "test-key", p_limit: 5, p_window_ms: 60_000 });
  });

  it("returns ok:false with retryAfterMs when the RPC reports the limit exceeded", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_ms: 12_345 }], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: false, retryAfterMs: 12_345 });
  });

  it("fails open when the RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("connection refused") });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
  });

  it("fails open when the RPC returns no rows", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
  });
});
