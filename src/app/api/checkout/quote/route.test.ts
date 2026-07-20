import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), createAdminClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/checkout/quote", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ ok: true });
});

describe("POST /api/checkout/quote", () => {
  it("checks the rate limit before touching the database", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 5_000 });

    const response = await POST(
      request({
        shopId: "11111111-1111-4111-8111-111111111111",
        fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
        lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keys the rate limit by client IP", async () => {
    await POST(
      request({
        shopId: "11111111-1111-4111-8111-111111111111",
        fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
        lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
      }),
    ).catch(() => {});

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining("203.0.113.5"), expect.any(Object));
  });
});
