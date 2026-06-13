import { describe, expect, it } from "vitest";

import { parseGuestOrder } from "@/lib/commerce/order";

describe("parseGuestOrder", () => {
  it("normalizes Ghana guest checkout details", () => {
    const result = parseGuestOrder({
      shopId: crypto.randomUUID(),
      fulfillmentMethodId: crypto.randomUUID(),
      idempotencyKey: "checkout-12345678",
      paymentMethod: "cash_on_delivery",
      buyer: {
        name: " Ama Buyer ",
        email: "AMA@EXAMPLE.COM",
        phone: "024 123 4567",
        country: "GH",
        address: { line1: "1 Market St", area: "Osu", city: "Accra", region: "Greater Accra" },
        marketingConsent: false,
      },
      lines: [{ productId: crypto.randomUUID(), quantity: 1 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buyer.email).toBe("ama@example.com");
      expect(result.data.buyer.phone).toBe("+233241234567");
    }
  });

  it("rejects empty carts", () => {
    expect(
      parseGuestOrder({
        shopId: crypto.randomUUID(),
        fulfillmentMethodId: crypto.randomUUID(),
        idempotencyKey: "checkout-12345678",
        paymentMethod: "paystack",
        buyer: {},
        lines: [],
      }).success,
    ).toBe(false);
  });
});
