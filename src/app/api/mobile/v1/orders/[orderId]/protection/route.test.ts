import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireActiveSeller: vi.fn(), protectionForSeller: vi.fn() }));

vi.mock("@/lib/mobile/guard", () => ({
  requireActiveSeller: mocks.requireActiveSeller,
  isResponse: (value: unknown) => value instanceof Response,
}));
vi.mock("@/lib/protect/service", () => ({ protectionForSeller: mocks.protectionForSeller }));

import { GET } from "./route";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const call = (orderId = ORDER_ID) =>
  GET(new Request("http://localhost"), { params: Promise.resolve({ orderId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireActiveSeller.mockResolvedValue({ sellerAccountId: "seller-1" });
});

describe("GET /api/mobile/v1/orders/[orderId]/protection", () => {
  it("returns the seller-safe view with a rider link while in transit", async () => {
    mocks.protectionForSeller.mockResolvedValue({
      state: "in_transit",
      riderToken: "rider-1",
      dispatchedAt: null,
      deliveryConfirmedAt: null,
      confirmationMethod: null,
      autoReleaseAt: null,
      inspectionEndsAt: null,
      codeLocked: false,
    });
    const body = await (await call()).json();
    expect(body.protection).toMatchObject({ state: "in_transit" });
    expect(body.protection.riderUrl).toMatch(/\/d\/rider-1$/);
    expect(JSON.stringify(body)).not.toMatch(/code_hash|delivery_code/);
    expect(mocks.protectionForSeller).toHaveBeenCalledWith(ORDER_ID, "seller-1");
  });

  it("returns null for an unprotected or someone else's order", async () => {
    mocks.protectionForSeller.mockResolvedValue(null);
    const body = await (await call()).json();
    expect(body.protection).toBeNull();
  });
});
