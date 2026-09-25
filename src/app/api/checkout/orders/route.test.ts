import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Only the buyer-accounts hook is under test here: that a placed order is
 * handed to linkCheckoutOrderToBuyer after the response, with ids from the
 * database rather than the request, and that nothing about it can change what
 * the buyer is told. Totals, stock and payment are the RPC's business and are
 * deliberately not exercised.
 */

const mocks = vi.hoisted(() => ({
  after: [] as (() => unknown)[],
  rpc: vi.fn(),
  link: vi.fn(),
  orderRow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => {
    mocks.after.push(callback);
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: () => undefined }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueOrderEventNotification: vi.fn() }));
vi.mock("@/lib/integrations/events", () => ({ enqueueIntegrationEvent: vi.fn() }));
vi.mock("@/lib/buyer/link-order", () => ({ linkCheckoutOrderToBuyer: mocks.link }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) =>
      table === "orders"
        ? { select: () => ({ eq: () => ({ maybeSingle: mocks.orderRow }) }) }
        : { update: () => ({ eq: () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }) }) },
  }),
}));

import { POST } from "./route";

const BODY = {
  shopId: "00000000-0000-4000-8000-000000000001",
  fulfillmentMethodId: "00000000-0000-4000-8000-000000000002",
  idempotencyKey: "checkout-key-123",
  paymentMethod: "cash_on_delivery",
  buyer: {
    name: "Ama Mensah",
    email: "ama@example.com",
    phone: "0241234567",
    country: "GH",
    address: { line1: "12 Oxford St", area: "", city: "Accra", region: "" },
  },
  lines: [{ productId: "00000000-0000-4000-8000-000000000003", quantity: 1 }],
};

function request(body: unknown = BODY) {
  return new Request("http://localhost/api/checkout/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.length = 0;
  mocks.rpc.mockResolvedValue({ data: { orderId: "order-1", trackingToken: "tok" }, error: null });
  mocks.orderRow.mockResolvedValue({
    data: { customer_id: "c1", public_reference: "SD-1", seller_account_id: "seller-1", total_minor: 1000, currency: "GHS" },
    error: null,
  });
  mocks.link.mockResolvedValue("linked");
});

describe("POST /api/checkout/orders — buyer link hook", () => {
  it("schedules the link after the response, with the seller from the stored order", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(1);

    await mocks.after[0]();
    expect(mocks.link).toHaveBeenCalledWith("order-1", "seller-1");
  });

  it("does not schedule anything when the order was not placed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Out of stock" } });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.after).toHaveLength(0);
  });

  it("returns the created order unchanged whatever the link does", async () => {
    mocks.link.mockResolvedValue("failed");

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({ orderId: "order-1", trackingToken: "tok" });
  });
});
