import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  hasPermission: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  advanceFulfillment: vi.fn(),
  resolveBookingAdapter: vi.fn(),
  isIntegratedCourier: vi.fn(),
  bookOrderWithAdapter: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/auth/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/supabase/request", () => ({
  createRequestScopedClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/orders/fulfillment", () => ({ advanceFulfillment: mocks.advanceFulfillment }));
vi.mock("@/lib/couriers/registry", () => ({
  resolveBookingAdapter: mocks.resolveBookingAdapter,
  isIntegratedCourier: mocks.isIntegratedCourier,
}));
vi.mock("@/lib/couriers/booking", () => ({ bookOrderWithAdapter: mocks.bookOrderWithAdapter }));

import { POST } from "./route";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

const SELLER_ACTOR = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

function request(body: unknown) {
  return new Request("http://localhost/api/couriers/book", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Enough of the Supabase client for this route: an orders lookup, a shipments
 * upsert, an orders update and an order_events insert. `upserted` captures the
 * row so tests can assert what was actually persisted.
 */
function supabaseStub(
  fulfillmentStatus = "confirmed",
  status = "confirmed",
  existingShipment: Record<string, unknown> | null = null,
) {
  const upserted: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: ORDER_ID, status, fulfillment_status: fulfillmentStatus },
                  }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        };
      }
      if (table === "shipments") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingShipment }) }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row);
            return {
              // The database returns the stored row with its id.
              select: () => ({ single: () => Promise.resolve({ data: { id: "ship-1", ...row }, error: null }) }),
            };
          },
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, upserted, inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
  mocks.hasPermission.mockReturnValue(true);
  // Default: no courier integration is on, so every test above the adapter
  // section exercises the seller-arranged path exactly as before adapters.
  mocks.resolveBookingAdapter.mockResolvedValue(null);
  mocks.isIntegratedCourier.mockImplementation((id: string) => id === "sandbox");
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.advanceFulfillment.mockResolvedValue({
    ok: true,
    orderId: ORDER_ID,
    fulfillmentStatus: "dispatched",
    version: 2,
  });
  mocks.createAdminClient.mockReturnValue({
    rpc: mocks.rpc,
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  });
});

describe("POST /api/couriers/book", () => {
  // ---------------------------------------------------------------------
  // Stored-XSS guard. The tracking URL becomes an href on a buyer-facing page.
  // ---------------------------------------------------------------------
  it("rejects a javascript: trackingUrl before it reaches the database", async () => {
    const response = await POST(
      request({
        orderId: ORDER_ID,
        provider: "bolt",
        trackingUrl: "javascript:alert(document.cookie)",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects a data: trackingUrl", async () => {
    const response = await POST(
      request({ orderId: ORDER_ID, provider: "bolt", trackingUrl: "data:text/html,<script>" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Provider validation. `provider` was free text in the database until
  // 202608020066, and z.literal("manual") in this route until now.
  // ---------------------------------------------------------------------
  it("rejects a courier that is not in the catalogue", async () => {
    const response = await POST(request({ orderId: ORDER_ID, provider: "definitely-not-real" }));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects 'other' with no name, since the buyer would be told nothing", async () => {
    const response = await POST(request({ orderId: ORDER_ID, provider: "other" }));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("stores the catalogue label, not whatever the client claimed", async () => {
    const { client, upserted } = supabaseStub();
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({
        orderId: ORDER_ID,
        provider: "bolt",
        // A seller must not be able to relabel a Bolt delivery on the receipt.
        providerName: "Totally Legitimate Courier",
        trackingNumber: "RIDER-2048",
      }),
    );

    expect(response.status).toBe(201);
    expect(upserted[0]).toMatchObject({ provider: "bolt", provider_name: "Bolt" });
  });

  it("keeps the seller's own words for 'other'", async () => {
    const { client, upserted } = supabaseStub();
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({ orderId: ORDER_ID, provider: "other", providerName: "Kwame Express" }),
    );

    expect(response.status).toBe(201);
    expect(upserted[0]).toMatchObject({ provider: "other", provider_name: "Kwame Express" });
  });

  it("generates a reference the buyer can quote when none is given", async () => {
    const { client, upserted } = supabaseStub();
    mocks.createClient.mockResolvedValue(client);

    await POST(request({ orderId: ORDER_ID, provider: "yango" }));

    expect(String(upserted[0].tracking_number)).toMatch(/^SD-[0-9A-F]{8}$/);
  });

  it("accepts an https tracking link", async () => {
    const { client, upserted } = supabaseStub();
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({
        orderId: ORDER_ID,
        provider: "bolt",
        trackingNumber: "RIDER-2048",
        trackingUrl: "https://track.example/abc",
      }),
    );

    expect(response.status).toBe(201);
    expect(upserted[0]).toMatchObject({ tracking_url: "https://track.example/abc" });
  });

  // ---------------------------------------------------------------------
  // The buyer has to be told. This route advanced fulfilment to 'dispatched'
  // without ever notifying anyone, unlike every other status change.
  // ---------------------------------------------------------------------
  it("dispatches through the guarded fulfilment path, which notifies the buyer", async () => {
    const { client } = supabaseStub("confirmed");
    mocks.createClient.mockResolvedValue(client);

    await POST(request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }));

    expect(mocks.advanceFulfillment).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      orderId: ORDER_ID,
      next: "dispatched",
      source: "booking",
      detail: { trackingNumber: "R1", provider: "bolt" },
    });
  });

  it("does not re-dispatch when the order is already past dispatch", async () => {
    const { client } = supabaseStub("fulfilled");
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }),
    );

    // Correcting a tracking number on a delivered order must not tell the buyer
    // it has just shipped.
    expect(response.status).toBe(201);
    expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
  });

  it("books delivery for a paid order whose fulfilment still reads unconfirmed", async () => {
    // Payment capture confirms the sale but leaves fulfilment at unconfirmed.
    const { client } = supabaseStub("unconfirmed", "confirmed");
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }));

    expect(response.status).toBe(201);
    expect(mocks.advanceFulfillment).toHaveBeenCalled();
  });

  it("refuses to book delivery for an order that is not confirmed", async () => {
    const { client, upserted } = supabaseStub("unconfirmed", "pending");
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }),
    );

    expect(response.status).toBe(409);
    expect(upserted).toEqual([]);
    expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
  });

  it("still returns success when the dispatch cannot be applied", async () => {
    const { client } = supabaseStub("confirmed");
    mocks.createClient.mockResolvedValue(client);
    mocks.advanceFulfillment.mockResolvedValue({ ok: false, reason: "version_conflict" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }),
    );

    // The shipment is already saved; failing the request would make the seller
    // think it had not been.
    expect(response.status).toBe(201);
  });

  it("refuses a seller without orders.manage", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await POST(request({ orderId: ORDER_ID, provider: "bolt" }));

    expect(response.status).toBe(401);
  });
  // ---------------------------------------------------------------------
  // Adapter booking: a courier with a live integration and its flag on is
  // booked through the partner API, idempotently, then dispatched the same way.
  // ---------------------------------------------------------------------
  describe("through a courier adapter", () => {
    const adapter = { id: "sandbox", label: "Sandbox Courier" };

    it("books through the adapter and stores the partner booking id", async () => {
      const { client, upserted } = supabaseStub("confirmed");
      mocks.createClient.mockResolvedValue(client);
      mocks.resolveBookingAdapter.mockResolvedValue(adapter);
      mocks.bookOrderWithAdapter.mockResolvedValue({
        ok: true,
        result: {
          providerBookingId: "sbx_abc",
          trackingNumber: "SBX-1234",
          trackingUrl: "https://track.example/sbx",
          labelUrl: null,
          status: "booked",
          amountMinor: null,
        },
      });

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(201);
      expect(mocks.resolveBookingAdapter).toHaveBeenCalledWith("sandbox", {
        sellerAccountId: "seller-1",
        country: "GH",
      });
      expect(upserted[0]).toMatchObject({
        provider: "sandbox",
        provider_name: "Sandbox Courier",
        provider_shipment_id: "sbx_abc",
        tracking_number: "SBX-1234",
        booked_via: "adapter",
      });
      expect(mocks.advanceFulfillment).toHaveBeenCalledWith(
        expect.objectContaining({ next: "dispatched", source: "booking" }),
      );
    });

    it("charges the seller's held settlement for a booking on SnapDuka's courier account", async () => {
      const { client } = supabaseStub("confirmed");
      mocks.createClient.mockResolvedValue(client);
      mocks.resolveBookingAdapter.mockResolvedValue(adapter);
      mocks.bookOrderWithAdapter.mockResolvedValue({
        ok: true,
        platformCharge: { estimateMinor: 1500 },
        result: {
          providerBookingId: "sbx_abc",
          trackingNumber: "SBX-1234",
          trackingUrl: null,
          labelUrl: null,
          status: "booked",
          amountMinor: 1800,
        },
      });

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(201);
      // The courier's actual price wins over the estimate.
      expect(mocks.rpc).toHaveBeenCalledWith("charge_courier_booking", {
        p_shipment_id: "ship-1",
        p_cost_minor: 1800,
      });
    });

    it("does not record anything when the courier refuses", async () => {
      const { client, upserted } = supabaseStub("confirmed");
      mocks.createClient.mockResolvedValue(client);
      mocks.resolveBookingAdapter.mockResolvedValue(adapter);
      mocks.bookOrderWithAdapter.mockResolvedValue({
        ok: false,
        reason: "courier_unavailable",
        message: "Sandbox Courier did not respond.",
      });

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(502);
      expect(upserted).toEqual([]);
      expect(mocks.advanceFulfillment).not.toHaveBeenCalled();
    });

    it("never books an unconfirmed order through an adapter either", async () => {
      const { client, upserted } = supabaseStub("unconfirmed", "pending");
      mocks.createClient.mockResolvedValue(client);
      mocks.resolveBookingAdapter.mockResolvedValue(adapter);

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(409);
      expect(upserted).toEqual([]);
      expect(mocks.bookOrderWithAdapter).not.toHaveBeenCalled();
      expect(mocks.resolveBookingAdapter).not.toHaveBeenCalled();
    });

    it("books a paid order whose fulfilment still reads unconfirmed through the adapter", async () => {
      const { client, upserted } = supabaseStub("unconfirmed", "confirmed");
      mocks.createClient.mockResolvedValue(client);
      mocks.resolveBookingAdapter.mockResolvedValue(adapter);
      mocks.bookOrderWithAdapter.mockResolvedValue({
        ok: true,
        result: {
          providerBookingId: "sbx_def",
          trackingNumber: "SBX-5678",
          trackingUrl: null,
          labelUrl: null,
          status: "booked",
          amountMinor: null,
        },
      });

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(201);
      expect(upserted[0]).toMatchObject({ booked_via: "adapter", provider_shipment_id: "sbx_def" });
      expect(mocks.advanceFulfillment).toHaveBeenCalledWith({
        sellerAccountId: "seller-1",
        orderId: ORDER_ID,
        next: "dispatched",
        source: "booking",
        detail: { trackingNumber: "SBX-5678", provider: "sandbox" },
      });
    });

    it("refuses an integration-only courier whose flag is off", async () => {
      const { client, upserted } = supabaseStub("confirmed");
      mocks.createClient.mockResolvedValue(client);

      const response = await POST(request({ orderId: ORDER_ID, provider: "sandbox" }));

      expect(response.status).toBe(400);
      expect(upserted).toEqual([]);
    });

    it("keeps a catalogue courier seller-arranged when its flag is off", async () => {
      const { client, upserted } = supabaseStub("confirmed");
      mocks.createClient.mockResolvedValue(client);

      await POST(request({ orderId: ORDER_ID, provider: "yango", trackingNumber: "R9" }));

      expect(mocks.bookOrderWithAdapter).not.toHaveBeenCalled();
      expect(upserted[0]).toMatchObject({ provider: "yango", booked_via: "seller", provider_shipment_id: null });
    });

    it("will not overwrite a live partner booking with a different courier", async () => {
      const { client, upserted } = supabaseStub("confirmed", "confirmed", {
        provider: "sandbox",
        booked_via: "adapter",
        status: "booked",
      });
      mocks.createClient.mockResolvedValue(client);

      const response = await POST(request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }));

      expect(response.status).toBe(409);
      expect(upserted).toEqual([]);
    });
  });
});
