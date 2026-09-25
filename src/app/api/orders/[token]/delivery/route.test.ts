import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  confirmDelivery: vi.fn(),
  reissueDeliveryCode: vi.fn(),
  order: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/protect/service", () => ({
  confirmDelivery: mocks.confirmDelivery,
  reissueDeliveryCode: mocks.reissueDeliveryCode,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.order() }) }) }) }),
  }),
}));

import { POST } from "./route";

const TOKEN = "22222222-2222-4222-8222-222222222222";

function call(body: unknown) {
  return POST(
    new Request(`http://localhost/api/orders/${TOKEN}/delivery`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.order.mockReturnValue({ id: "order-1" });
});

describe("POST /api/orders/[token]/delivery", () => {
  it("lets the buyer confirm receipt without a code", async () => {
    mocks.confirmDelivery.mockResolvedValue("confirmed");
    const response = await call({ action: "confirm" });
    expect(response.status).toBe(200);
    expect(mocks.confirmDelivery).toHaveBeenCalledWith("order-1", "buyer_tap");
  });

  it("returns a freshly rotated code only to the tracking-token holder, uncached", async () => {
    mocks.reissueDeliveryCode.mockResolvedValue("654321");
    const response = await call({ action: "new_code" });
    expect(await response.json()).toEqual({ code: "654321" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses a new code when the order is not on its way", async () => {
    mocks.reissueDeliveryCode.mockResolvedValue(null);
    const response = await call({ action: "new_code" });
    expect(response.status).toBe(409);
  });

  it("does not find an unknown tracking token", async () => {
    mocks.order.mockReturnValue(null);
    const response = await call({ action: "confirm" });
    expect(response.status).toBe(404);
    expect(mocks.confirmDelivery).not.toHaveBeenCalled();
  });
});
