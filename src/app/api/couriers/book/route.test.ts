import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  hasPermission: vi.fn(),
  createClient: vi.fn(),
  courierAdapter: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/auth/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/couriers/registry", () => ({ courierAdapter: mocks.courierAdapter }));

import { POST } from "./route";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
  mocks.hasPermission.mockReturnValue(true);
});

describe("POST /api/couriers/book", () => {
  it("rejects a javascript: trackingUrl before it ever reaches the courier adapter or the database (stored XSS guard)", async () => {
    const response = await POST(
      request({
        orderId: "11111111-1111-4111-8111-111111111111",
        quoteId: "q1",
        trackingUrl: "javascript:alert(document.cookie)",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.courierAdapter).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects a data: trackingUrl", async () => {
    const response = await POST(
      request({
        orderId: "11111111-1111-4111-8111-111111111111",
        quoteId: "q1",
        trackingUrl: "data:text/html,<script>alert(1)</script>",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.courierAdapter).not.toHaveBeenCalled();
  });

  it("accepts a real https trackingUrl and books the shipment", async () => {
    const book = vi.fn().mockResolvedValue({
      id: "ship-1",
      provider: "manual",
      trackingNumber: "MAN-00000000",
      trackingUrl: "https://tracking.example.com/MAN-00000000",
      labelUrl: null,
      status: "booked",
    });
    mocks.courierAdapter.mockReturnValue({ book });

    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "order-1", fulfillment_status: "confirmed" } });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const single = vi.fn().mockResolvedValue({ data: { id: "ship-1" }, error: null });
    const upsertSelect = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select: upsertSelect });
    const updateEq2 = vi.fn().mockResolvedValue({});
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    const insert = vi.fn().mockResolvedValue({});
    const from = vi.fn((table: string) => {
      if (table === "orders") return { select, update };
      if (table === "shipments") return { upsert };
      if (table === "order_events") return { insert };
      return {};
    });
    mocks.createClient.mockResolvedValue({ from });

    const response = await POST(
      request({
        orderId: "11111111-1111-4111-8111-111111111111",
        quoteId: "q1",
        trackingUrl: "https://tracking.example.com/MAN-00000000",
      }),
    );

    expect(response.status).toBe(201);
    expect(book).toHaveBeenCalled();
  });
});
