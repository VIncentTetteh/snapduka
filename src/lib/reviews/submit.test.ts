import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { submitReview } from "./submit";

/**
 * A review is only worth anything if it came from someone who actually bought
 * the thing. These cover the three checks that make that true, and the ways a
 * leaked tracking token could otherwise be abused.
 */

type OrderRow = {
  id: string;
  shop_id: string;
  seller_account_id: string;
  customer_id: string | null;
  payment_status: string;
  buyer_snapshot: { name?: string } | null;
};

const ORDER: OrderRow = {
  id: "order-1",
  shop_id: "shop-1",
  seller_account_id: "seller-1",
  customer_id: "cust-1",
  payment_status: "paid",
  buyer_snapshot: { name: "Ama" },
};

/** Captures what was inserted so the assertions can look at it. */
let inserted: Record<string, unknown> | null = null;

function client(options: {
  order?: OrderRow | null;
  lineCount?: number;
  insertError?: { code?: string } | null;
}) {
  const { order = ORDER, lineCount = 1, insertError = null } = options;
  inserted = null;

  return {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order }) }) }),
        };
      }
      if (table === "order_lines") {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ count: lineCount }) }) }),
        };
      }
      return {
        insert(row: Record<string, unknown>) {
          inserted = row;
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: insertError }
                  : { data: { id: "review-1" }, error: null },
            }),
          };
        },
      };
    },
  };
}

const INPUT = { trackingToken: "tok-1", productId: "prod-1", rating: 5, body: "Lovely." };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue(client({}));
});

describe("submitReview", () => {
  it("writes a review for a paid order that contained the product", async () => {
    const result = await submitReview(INPUT);

    expect(result).toEqual({ ok: true, reviewId: "review-1" });
    expect(inserted).toMatchObject({
      product_id: "prod-1",
      order_id: "order-1",
      seller_account_id: "seller-1",
      shop_id: "shop-1",
      rating: 5,
      body: "Lovely.",
    });
  });

  it("refuses a token that matches no order", async () => {
    mocks.createAdminClient.mockReturnValue(client({ order: null }));

    const result = await submitReview(INPUT);

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(inserted).toBeNull();
  });

  // The important one: without it, one order's token would let someone review
  // the seller's entire catalogue.
  it("refuses a product that was not in the order", async () => {
    mocks.createAdminClient.mockReturnValue(client({ lineCount: 0 }));

    const result = await submitReview(INPUT);

    expect(result).toMatchObject({ ok: false, reason: "not_purchased" });
    expect(inserted).toBeNull();
  });

  it("refuses an order that has not been paid for", async () => {
    for (const payment_status of ["unpaid", "pending", "failed", "offline_due", "refunded"]) {
      mocks.createAdminClient.mockReturnValue(client({ order: { ...ORDER, payment_status } }));

      const result = await submitReview(INPUT);

      expect(result, payment_status).toMatchObject({ ok: false, reason: "not_paid" });
    }
  });

  it("allows a partially refunded order — they still bought and received it", async () => {
    mocks.createAdminClient.mockReturnValue(
      client({ order: { ...ORDER, payment_status: "partially_refunded" } }),
    );

    expect(await submitReview(INPUT)).toMatchObject({ ok: true });
  });

  it("rejects a rating outside one to five", async () => {
    for (const rating of [0, 6, -1, 2.5]) {
      const result = await submitReview({ ...INPUT, rating });
      if (rating === 2.5) {
        // Truncated to 2, which is a real rating.
        expect(result).toMatchObject({ ok: true });
        continue;
      }
      expect(result, String(rating)).toMatchObject({ ok: false, reason: "invalid" });
    }
  });

  it("reports a second review of the same item as already reviewed", async () => {
    mocks.createAdminClient.mockReturnValue(client({ insertError: { code: "23505" } }));

    const result = await submitReview(INPUT);

    expect(result).toMatchObject({ ok: false, reason: "duplicate" });
  });

  it("falls back to the name captured at checkout", async () => {
    await submitReview(INPUT);
    expect(inserted).toMatchObject({ author_name: "Ama" });
  });

  it("never leaves the author blank, even with no name anywhere", async () => {
    mocks.createAdminClient.mockReturnValue(client({ order: { ...ORDER, buyer_snapshot: null } }));

    await submitReview(INPUT);

    expect(inserted).toMatchObject({ author_name: "Verified buyer" });
  });

  it("stores an empty body as null rather than an empty string", async () => {
    await submitReview({ ...INPUT, body: "   " });
    expect(inserted).toMatchObject({ body: null });
  });
});
