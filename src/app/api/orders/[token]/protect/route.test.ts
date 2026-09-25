import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  isFeatureEnabled: vi.fn(),
  setOrderProtection: vi.fn(),
  order: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/protect/service", () => ({ setOrderProtection: mocks.setOrderProtection }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.order() }) }) }) }),
  }),
}));

import { POST } from "./route";

const TOKEN = "22222222-2222-4222-8222-222222222222";

function call(body: unknown) {
  return POST(
    new Request(`http://localhost/api/orders/${TOKEN}/protect`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.order.mockReturnValue({ id: "order-1", seller_account_id: "seller-1" });
  mocks.isFeatureEnabled.mockResolvedValue(true);
});

describe("POST /api/orders/[token]/protect", () => {
  it("opts in and returns the new total", async () => {
    mocks.setOrderProtection.mockResolvedValue({ ok: true, protectionMode: "protect", protectFeeMinor: 150, totalMinor: 10150 });
    const response = await call({ enabled: true });
    expect(await response.json()).toEqual({ protectionMode: "protect", protectFeeMinor: 150, totalMinor: 10150 });
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("protect", { sellerAccountId: "seller-1" });
  });

  it("refuses to opt in while the rollout flag is off for this seller", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    const response = await call({ enabled: true });
    expect(response.status).toBe(409);
    expect(mocks.setOrderProtection).not.toHaveBeenCalled();
  });

  it("always allows opting out, flag or not", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    mocks.setOrderProtection.mockResolvedValue({ ok: true, protectionMode: "none", protectFeeMinor: 0, totalMinor: 10000 });
    const response = await call({ enabled: false });
    expect(response.status).toBe(200);
  });

  it("passes the database's buyer-safe refusal through", async () => {
    mocks.setOrderProtection.mockResolvedValue({ ok: false, message: "Protect is at capacity right now. You can still pay without it." });
    const response = await call({ enabled: true });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/capacity/);
  });
});
