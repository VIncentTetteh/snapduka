import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  advanceFulfillment: vi.fn(),
  adapter: null as null | {
    capabilities: { webhooks: boolean };
    verifyWebhook: (req: unknown) => Promise<boolean>;
    parseWebhook: (req: unknown) => unknown[];
  },
}));

vi.mock("@/lib/couriers/registry", () => ({
  isIntegratedCourier: () => mocks.adapter !== null,
  getCourierAdapter: () => mocks.adapter,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/orders/fulfillment", () => ({ advanceFulfillment: mocks.advanceFulfillment }));

import { POST } from "./route";

const SECRET = "courier-secret";
const SHIPMENT = { id: "ship-1", seller_account_id: "seller-1", order_id: "order-1" };

function call(body: unknown, auth = `Bearer ${SECRET}`, provider = "yango") {
  return POST(
    new Request(`http://localhost/api/couriers/webhook/${provider}`, {
      method: "POST",
      headers: { authorization: auth },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider }) },
  );
}

function fakeAdmin(opts: { shipment?: typeof SHIPMENT | null; eventErrorCode?: string } = {}) {
  const lookups: [string, unknown][] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      if (table === "shipments") {
        return {
          select: () => {
            const chain = {
              eq: (column: string, value: unknown) => {
                lookups.push([column, value]);
                return chain;
              },
              maybeSingle: async () => ({
                data: opts.shipment === undefined ? SHIPMENT : opts.shipment,
              }),
            };
            return chain;
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          if (table === "shipment_events" && opts.eventErrorCode) {
            return { error: { code: opts.eventErrorCode } };
          }
          return { error: null };
        },
      };
    },
  };
  return { client, inserts, lookups };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adapter = null;
  vi.stubEnv("COURIER_YANGO_WEBHOOK_SECRET", SECRET);
  mocks.advanceFulfillment.mockResolvedValue({ ok: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/couriers/webhook/[provider]", () => {
  it("rejects a wrong secret", async () => {
    const response = await call({ trackingNumber: "T1", status: "delivered" }, "Bearer nope");
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a provider with no configured secret", async () => {
    const response = await call({ trackingNumber: "T1", status: "delivered" }, `Bearer ${SECRET}`, "dhl");
    expect(response.status).toBe(401);
  });

  it("rejects an unknown status", async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin().client);
    const response = await call({ trackingNumber: "T1", status: "teleported" });
    expect(response.status).toBe(400);
  });

  it("delivers through the guarded fulfilment path as a courier", async () => {
    const admin = fakeAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await call({ id: "evt-1", trackingNumber: "T1", status: "delivered" });

    expect(await response.json()).toEqual({ received: true, applied: true, advanced: true });
    expect(mocks.advanceFulfillment).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      orderId: "order-1",
      next: "fulfilled",
      source: "courier",
      detail: { trackingNumber: "T1", provider: "yango" },
    });
    expect(admin.inserts.map((i) => i.table)).toEqual(["shipment_events", "order_events"]);
  });

  it("maps in_transit to dispatched", async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin().client);
    await call({ id: "evt-2", trackingNumber: "T1", status: "in_transit" });
    expect(mocks.advanceFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({ next: "dispatched" }),
    );
  });

  it("records a failed delivery without moving the order", async () => {
    const admin = fakeAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);
    const response = await call({ id: "evt-3", trackingNumber: "T1", status: "failed" });
    expect(await response.json()).toMatchObject({ applied: true, advanced: false });
    expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
  });

  it("treats a redelivered event as a no-op", async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin({ eventErrorCode: "23505" }).client);
    const response = await call({ id: "evt-1", trackingNumber: "T1", status: "delivered" });
    expect(await response.json()).toEqual({ received: true, applied: false });
    expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
  });

  it("asks the courier to retry when the event cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createAdminClient.mockReturnValue(fakeAdmin({ eventErrorCode: "XX000" }).client);
    const response = await call({ id: "evt-4", trackingNumber: "T1", status: "delivered" });
    expect(response.status).toBe(500);
  });

  it("acknowledges an event for a shipment it does not know", async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin({ shipment: null }).client);
    const response = await call({ id: "evt-5", trackingNumber: "T9", status: "delivered" });
    expect(await response.json()).toEqual({ received: true, applied: false });
  });

  it("lets an integrated courier verify and parse its own webhook format", async () => {
    const admin = fakeAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);
    mocks.adapter = {
      capabilities: { webhooks: true },
      verifyWebhook: vi.fn(async () => true),
      parseWebhook: vi.fn(() => [
        { eventId: "p-1", providerBookingId: "bk-9", trackingNumber: null, status: "delivered", occurredAt: "", description: null },
      ]),
    };

    // No bearer header: the adapter's own signature check is what counts.
    const response = await call({ anything: true }, "");

    expect(response.status).toBe(200);
    expect(admin.lookups).toContainEqual(["provider_shipment_id", "bk-9"]);
    expect(mocks.advanceFulfillment).toHaveBeenCalledWith(expect.objectContaining({ next: "fulfilled", source: "courier" }));
  });

  it("rejects an integrated courier's webhook that fails its signature check", async () => {
    mocks.adapter = {
      capabilities: { webhooks: true },
      verifyWebhook: vi.fn(async () => false),
      parseWebhook: vi.fn(() => []),
    };
    const response = await call({ anything: true }, "");
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
