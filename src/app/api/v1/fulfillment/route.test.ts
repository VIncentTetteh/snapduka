import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateApi: vi.fn(),
  transitionOrder: vi.fn(),
  advanceFulfillment: vi.fn(),
  current: vi.fn(),
}));

vi.mock("@/lib/api-keys/auth", () => ({ authenticateApi: mocks.authenticateApi }));
vi.mock("@/lib/orders/transition", () => ({ transitionOrder: mocks.transitionOrder }));
vi.mock("@/lib/orders/fulfillment", () => ({ advanceFulfillment: mocks.advanceFulfillment }));

import { POST } from "./route";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const SELLER = "seller-1";

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/v1/fulfillment", {
      method: "POST",
      headers: { authorization: "Bearer sk_test" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateApi.mockResolvedValue({
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.current() }) }) }) }),
      }),
    },
    key: { seller_account_id: SELLER },
  });
  mocks.current.mockReturnValue({ event_version: 6 });
});

describe("POST /api/v1/fulfillment", () => {
  it("rejects callers without the fulfillment:write scope", async () => {
    mocks.authenticateApi.mockResolvedValue(null);
    const response = await call({ orderId: ORDER_ID, status: "dispatched", expectedVersion: 1 });
    expect(response.status).toBe(401);
    expect(mocks.authenticateApi).toHaveBeenCalledWith(expect.any(Request), "fulfillment:write");
  });

  it("still accepts an old integration without expectedVersion, and says it is deprecated", async () => {
    mocks.advanceFulfillment.mockResolvedValue({ ok: true, orderId: ORDER_ID, fulfillmentStatus: "dispatched", version: 7 });

    const response = await call({ orderId: ORDER_ID, status: "dispatched" });

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("warning")).toMatch(/expectedVersion/);
    // The current version is used, so the state machine and CAS still apply.
    expect(mocks.advanceFulfillment).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 6 }));
  });

  it("does not mark a call that sends expectedVersion as deprecated", async () => {
    mocks.advanceFulfillment.mockResolvedValue({ ok: true, orderId: ORDER_ID, fulfillmentStatus: "dispatched", version: 5 });
    const response = await call({ orderId: ORDER_ID, status: "dispatched", expectedVersion: 4 });
    expect(response.headers.get("deprecation")).toBeNull();
  });

  it("reports not found for someone else's order when the version must be looked up", async () => {
    mocks.current.mockReturnValue(null);
    const response = await call({ orderId: ORDER_ID, status: "dispatched" });
    expect(response.status).toBe(404);
    expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
  });

  it("routes dispatch through the guarded fulfilment path", async () => {
    mocks.advanceFulfillment.mockResolvedValue({
      ok: true,
      orderId: ORDER_ID,
      fulfillmentStatus: "dispatched",
      version: 5,
    });

    const response = await call({ orderId: ORDER_ID, status: "dispatched", expectedVersion: 4 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: ORDER_ID, fulfillment_status: "dispatched", event_version: 5 },
    });
    expect(mocks.advanceFulfillment).toHaveBeenCalledWith({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 4,
      source: "api",
    });
    expect(mocks.transitionOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmed", "confirmed", "confirmed"],
    ["preparing", "processing", "preparing"],
    ["fulfilled", "completed", "fulfilled"],
    ["cancelled", "cancelled", "cancelled"],
  ])(
    "maps %s onto the order transition %s so order and fulfilment cannot disagree",
    async (status, orderTransition, fulfillment) => {
      mocks.transitionOrder.mockResolvedValue({
        ok: true,
        orderId: ORDER_ID,
        status: orderTransition,
        version: 8,
      });

      const response = await call({ orderId: ORDER_ID, status, expectedVersion: 7 });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { id: ORDER_ID, fulfillment_status: fulfillment, event_version: 8 },
      });
      expect(mocks.transitionOrder).toHaveBeenCalledWith({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: orderTransition,
        expectedVersion: 7,
        offlinePaidConfirmed: undefined,
      });
    },
  );

  it("passes cash confirmation through when completing a cash order", async () => {
    mocks.transitionOrder.mockResolvedValue({ ok: true, orderId: ORDER_ID, status: "completed", version: 2 });
    await call({ orderId: ORDER_ID, status: "fulfilled", expectedVersion: 1, offlinePaidConfirmed: true });
    expect(mocks.transitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ offlinePaidConfirmed: true }),
    );
  });

  it.each([
    ["not_found", 404],
    ["version_conflict", 409],
    ["illegal_transition", 409],
    ["offline_unconfirmed", 409],
  ])("maps %s to HTTP %i with a stable error code", async (reason, status) => {
    mocks.transitionOrder.mockResolvedValue({ ok: false, reason });
    const response = await call({ orderId: ORDER_ID, status: "fulfilled", expectedVersion: 1 });
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(reason);
  });
});
