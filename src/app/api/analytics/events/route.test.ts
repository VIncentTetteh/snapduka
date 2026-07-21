import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), createAdminClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/analytics/events", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("POST /api/analytics/events", () => {
  it("rejects when the rate limit is exceeded, before any database write", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });

    const response = await POST(
      request({
        id: "11111111-1111-4111-8111-111111111111",
        shopId: "22222222-2222-4222-8222-222222222222",
        sessionId: "33333333-3333-4333-8333-333333333333",
        eventType: "product_view",
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
