import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ order: vi.fn(), upsert: vi.fn(), product: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));
vi.mock("@/lib/couriers/aggregate", () => ({ quoteDelivery: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        maybeSingle: table === "orders" ? mocks.order : mocks.product,
        upsert: mocks.upsert,
      };
      return chain;
    },
  }),
}));

import { createToolBackend, searchTerms } from "./backend";

const BINDING = {
  sellerAccountId: "seller-1",
  buyerPhone: "+233201234567",
  shop: { id: "shop-1", slug: "kofi-shoes-k7m2", slugCode: "k7m2", displayName: "Kofi", currency: "GHS" as const },
};
const PRODUCT_ID = "0f000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.product.mockResolvedValue({
    data: {
      id: PRODUCT_ID,
      name: "Sneakers",
      description: "",
      price_minor: 45000,
      compare_at_price_minor: null,
      currency: "GHS",
      inventory_policy: "track",
      stock_quantity: 3,
      reserved_quantity: 0,
    },
  });
});

describe("searchTerms", () => {
  // Only letters and digits reach the PostgREST `or=` filter: a comma or a dot
  // from the buyer would otherwise inject another filter clause.
  it("keeps letters and digits only", () => {
    expect(searchTerms("black, sneakers.name.eq.x size-42 ɔkɔ")).toEqual(["black", "sneakers", "name", "size"]);
  });
});

describe("getOrderStatus", () => {
  it("answers for the buyer who placed the order", async () => {
    mocks.order.mockResolvedValue({
      data: {
        public_reference: "SD-ABC123",
        status: "confirmed",
        payment_status: "paid",
        fulfillment_status: "unconfirmed",
        tracking_token: "tok",
        buyer_snapshot: { phone: "+233 20 123 4567" },
      },
    });
    await expect(createToolBackend(BINDING).getOrderStatus("SD-ABC123")).resolves.toEqual({
      found: true,
      reference: "SD-ABC123",
      status: "confirmed",
      fulfillment: "unconfirmed",
      payment: "paid",
      trackingUrl: "https://snapduka.test/orders/tok",
    });
  });

  // A reference is printed on receipts and screenshots; it is not proof.
  it("says not found for someone else's order", async () => {
    mocks.order.mockResolvedValue({
      data: {
        public_reference: "SD-ABC123",
        status: "confirmed",
        payment_status: "paid",
        fulfillment_status: "unconfirmed",
        tracking_token: "tok",
        buyer_snapshot: { phone: "+233209999999" },
      },
    });
    await expect(createToolBackend(BINDING).getOrderStatus("SD-ABC123")).resolves.toEqual({ found: false });
  });
});

describe("createCheckoutLink", () => {
  it("mints a tracked /l/ link on the whatsapp channel pointing at the product page", async () => {
    await expect(createToolBackend(BINDING).createCheckoutLink(PRODUCT_ID)).resolves.toEqual({
      url: "https://snapduka.test/l/wa-k7m2-0f00000000",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_account_id: "seller-1",
        shop_id: "shop-1",
        token: "wa-k7m2-0f00000000",
        channel: "whatsapp",
        destination_path: `/kofi-shoes-k7m2/products/${PRODUCT_ID}`,
      }),
      { onConflict: "token", ignoreDuplicates: true },
    );
  });

  it("refuses a product that is not this shop's active product", async () => {
    mocks.product.mockResolvedValue({ data: null });
    await expect(createToolBackend(BINDING).createCheckoutLink(PRODUCT_ID)).resolves.toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
