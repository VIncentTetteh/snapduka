import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  confirmDelivery: vi.fn(),
  protectionForRiderToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/protect/service", () => ({
  confirmDelivery: mocks.confirmDelivery,
  protectionForRiderToken: mocks.protectionForRiderToken,
}));

import { POST } from "./route";

const RIDER = "11111111-1111-4111-8111-111111111111";

function call(body: unknown, token = RIDER) {
  return POST(
    new Request(`http://localhost/api/protect/rider/${token}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ riderToken: token }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.protectionForRiderToken.mockResolvedValue({ view: { orderId: "order-1" }, reference: "SD-1", shopName: "Shop" });
});

describe("POST /api/protect/rider/[riderToken]", () => {
  it("confirms with the buyer's code as a rider confirmation", async () => {
    mocks.confirmDelivery.mockResolvedValue("confirmed");
    const response = await call({ code: "123456" });
    expect(response.status).toBe(200);
    expect(mocks.confirmDelivery).toHaveBeenCalledWith("order-1", "rider_code", "123456");
  });

  it("rejects a malformed code without touching the database", async () => {
    const response = await call({ code: "12ab" });
    expect(response.status).toBe(400);
    expect(mocks.confirmDelivery).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", 400],
    ["locked", 423],
    ["not_in_transit", 409],
  ])("maps %s to %i", async (outcome, status) => {
    mocks.confirmDelivery.mockResolvedValue(outcome);
    const response = await call({ code: "123456" });
    expect(response.status).toBe(status);
  });

  it("rate-limits per token and per IP", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, retryAfterMs: 1 });
    const response = await call({ code: "123456" });
    expect(response.status).toBe(429);
    expect(mocks.confirmDelivery).not.toHaveBeenCalled();
  });

  it("does not find an unknown rider token", async () => {
    mocks.protectionForRiderToken.mockResolvedValue(null);
    const response = await call({ code: "123456" });
    expect(response.status).toBe(404);
  });
});
