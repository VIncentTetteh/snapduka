import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  hasPermission: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/auth/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

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
function supabaseStub(fulfillmentStatus = "confirmed") {
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
                    data: { id: ORDER_ID, fulfillment_status: fulfillmentStatus },
                  }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        };
      }
      if (table === "shipments") {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row);
            return {
              select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
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
  mocks.rpc.mockResolvedValue({ error: null });
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
  it("notifies the buyer when the order becomes dispatched", async () => {
    const { client } = supabaseStub("confirmed");
    mocks.createClient.mockResolvedValue(client);

    await POST(request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }));

    expect(mocks.rpc).toHaveBeenCalledWith("enqueue_order_notification", {
      p_order_id: ORDER_ID,
      p_event: "dispatched",
    });
  });

  it("does not re-notify when the order is already past dispatch", async () => {
    const { client } = supabaseStub("fulfilled");
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(
      request({ orderId: ORDER_ID, provider: "bolt", trackingNumber: "R1" }),
    );

    // Correcting a tracking number on a delivered order must not tell the buyer
    // it has just shipped.
    expect(response.status).toBe(201);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still returns success when the notification cannot be queued", async () => {
    const { client } = supabaseStub("confirmed");
    mocks.createClient.mockResolvedValue(client);
    mocks.rpc.mockResolvedValue({ error: { message: "queue down" } });
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
});
