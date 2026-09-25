// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quoteDelivery: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/couriers/aggregate", () => ({ quoteDelivery: mocks.quoteDelivery }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from "./route";

const SHOP_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown, ip = "1.2.3.4") {
  return new Request("http://localhost/api/delivery/quote", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.quoteDelivery.mockResolvedValue({
    ok: true,
    currency: "GHS",
    options: [{ kind: "seller_method", fulfillmentMethodId: "fm", type: "delivery", label: "Delivery", feeMinor: 1000, currency: "GHS" }],
    courierNote: "no_couriers_enabled",
    cached: false,
  });
});

describe("POST /api/delivery/quote", () => {
  it("returns options without internal diagnostics", async () => {
    const response = await POST(request({ shopId: SHOP_ID, destination: { city: "Accra" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.options).toHaveLength(1);
    expect(body).not.toHaveProperty("courierNote");
  });

  it("normalises a GhanaPostGPS code and drops a malformed one", async () => {
    await POST(request({ shopId: SHOP_ID, destination: { city: "Accra", digitalAddress: "ga 123 4567" } }));
    expect(mocks.quoteDelivery.mock.calls[0][0].destination.digitalAddress).toBe("GA-123-4567");

    await POST(request({ shopId: SHOP_ID, destination: { city: "Accra", digitalAddress: "nonsense" } }));
    expect(mocks.quoteDelivery.mock.calls[1][0].destination.digitalAddress).toBeNull();
  });

  it("rate limits per IP", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4000 });
    const response = await POST(request({ shopId: SHOP_ID, destination: { city: "Accra" } }, "9.9.9.9"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("4");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("delivery:quote:9.9.9.9", expect.any(Object));
    expect(mocks.quoteDelivery).not.toHaveBeenCalled();
  });

  it("rejects half a location pin", async () => {
    const response = await POST(request({ shopId: SHOP_ID, destination: { city: "Accra", lat: 5.6 } }));
    expect(response.status).toBe(400);
  });

  it("404s an unknown shop", async () => {
    mocks.quoteDelivery.mockResolvedValue({ ok: false, reason: "shop_not_found" });
    const response = await POST(request({ shopId: SHOP_ID, destination: { city: "Accra" } }));
    expect(response.status).toBe(404);
  });
});
