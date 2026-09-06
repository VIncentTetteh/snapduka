import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({ initialize: mocks.initialize }),
}));

import { POST } from "./route";

/**
 * This route took an order UUID and nothing else, then built a Paystack page
 * prefilled with that buyer's email and a callback containing the order's
 * tracking_token — the capability that opens /orders/<token> with the buyer's
 * name, phone, address and items. An order id could be exchanged for a secret
 * an order id is not supposed to be equivalent to.
 */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const WRONG_TOKEN = "33333333-3333-4333-8333-333333333333";

const ORDER = {
  id: ORDER_ID,
  seller_account_id: "seller-1",
  total_minor: 5000,
  currency: "GHS",
  buyer_snapshot: { email: "buyer@example.com" },
  tracking_token: TOKEN,
  payment_method: "paystack",
  payment_status: "unpaid",
};

/** Serves the order only when every .eq() filter matches it. */
function adminMock() {
  return {
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const chain: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          // payment_attempts inserts read back with .single().
          single: () => Promise.resolve({ data: { id: "attempt-1" }, error: null }),
          maybeSingle: () => {
            if (table === "orders") {
              const matches =
                (filters.id === undefined || filters.id === ORDER_ID) &&
                (filters.tracking_token === undefined || filters.tracking_token === TOKEN);
              return Promise.resolve({ data: matches ? ORDER : null });
            }
            if (table === "seller_accounts") return Promise.resolve({ data: { country: "GH" } });
            // Ledger settlement, so no Paystack subaccount is required and the
            // route reaches the provider — which is the path under test.
            if (table === "country_configs") {
              return Promise.resolve({ data: { settlement_mode: "ledger" } });
            }
            return Promise.resolve({ data: null });
          },
        };
        return chain;
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "attempt-1" }, error: null }) }),
      }),
    }),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/payments/paystack/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payments/paystack/initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ ok: true });
    mocks.createAdminClient.mockReturnValue(adminMock());
    mocks.initialize.mockResolvedValue({
      authorizationUrl: "https://paystack.test/pay/abc",
      reference: "ref-1",
    });
  });

  it("refuses an order id with no tracking token", async () => {
    const response = await POST(request({ orderId: ORDER_ID }));

    expect(response.status).toBe(400);
    // Nothing reached Paystack, so no page carrying the buyer's email exists.
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("refuses an order id with somebody else's tracking token", async () => {
    const response = await POST(request({ orderId: ORDER_ID, trackingToken: WRONG_TOKEN }));

    expect(response.status).toBe(409);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("does not distinguish a wrong token from an ineligible order", async () => {
    const wrongToken = await POST(request({ orderId: ORDER_ID, trackingToken: WRONG_TOKEN }));
    const unknownOrder = await POST(
      request({ orderId: "44444444-4444-4444-8444-444444444444", trackingToken: TOKEN }),
    );

    // Same status and same body: a probe learns nothing about which part was wrong.
    expect(wrongToken.status).toBe(unknownOrder.status);
    expect(await wrongToken.json()).toEqual(await unknownOrder.json());
  });

  it("starts payment for the buyer who holds the token", async () => {
    const response = await POST(request({ orderId: ORDER_ID, trackingToken: TOKEN }));

    expect(response.status).toBe(200);
    expect(mocks.initialize).toHaveBeenCalled();
  });
});
