import { describe, expect, it } from "vitest";

import { checkoutIdempotencyKey, type CheckoutContents } from "./idempotency";

/**
 * `create_guest_order` returns the cached order on a key it has seen. Right for
 * a retry, wrong if the basket changed — and the key used to be a bare
 * per-mount UUID, so it survived the buyer changing their mind. After a failed
 * payment attempt they would switch to cheaper delivery or lower a quantity,
 * press Pay, and be charged the original order's total.
 */

const NONCE = "9f1c2b3a";

const BASKET: CheckoutContents = {
  fulfillmentMethodId: "method-delivery",
  paymentMethod: "paystack",
  promotionCode: "",
  lines: [{ productId: "prod-1", variantId: null, quantity: 2 }],
};

describe("checkoutIdempotencyKey", () => {
  it("is stable for the same basket, so a retry does not double-order", () => {
    expect(checkoutIdempotencyKey(NONCE, BASKET)).toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  // Each of these is a change the buyer can make after a failed payment, and
  // each used to be charged at the original order's total.
  it("changes when the delivery method changes", () => {
    const cheaper = { ...BASKET, fulfillmentMethodId: "method-pickup" };
    expect(checkoutIdempotencyKey(NONCE, cheaper)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  it("changes when a quantity changes", () => {
    const fewer = { ...BASKET, lines: [{ productId: "prod-1", variantId: null, quantity: 1 }] };
    expect(checkoutIdempotencyKey(NONCE, fewer)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  it("changes when a promo code is added", () => {
    const discounted = { ...BASKET, promotionCode: "LAUNCH20" };
    expect(checkoutIdempotencyKey(NONCE, discounted)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  it("changes when the payment method changes", () => {
    const cash = { ...BASKET, paymentMethod: "cash_on_delivery" };
    expect(checkoutIdempotencyKey(NONCE, cash)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  it("changes when a second item is added", () => {
    const bigger = {
      ...BASKET,
      lines: [...BASKET.lines, { productId: "prod-2", variantId: null, quantity: 1 }],
    };
    expect(checkoutIdempotencyKey(NONCE, bigger)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  it("distinguishes two variants of the same product", () => {
    const variant = { ...BASKET, lines: [{ productId: "prod-1", variantId: "var-1", quantity: 2 }] };
    expect(checkoutIdempotencyKey(NONCE, variant)).not.toBe(checkoutIdempotencyKey(NONCE, BASKET));
  });

  // Trivial differences must not mint a second order for the same basket.
  it("ignores the order lines arrive in", () => {
    const lines = [
      { productId: "prod-1", variantId: null, quantity: 2 },
      { productId: "prod-2", variantId: null, quantity: 1 },
    ];
    const forward = { ...BASKET, lines };
    const reversed = { ...BASKET, lines: [...lines].reverse() };

    expect(checkoutIdempotencyKey(NONCE, forward)).toBe(checkoutIdempotencyKey(NONCE, reversed));
  });

  it("ignores promo-code casing and padding", () => {
    const typed = { ...BASKET, promotionCode: "  launch20 " };
    const clean = { ...BASKET, promotionCode: "LAUNCH20" };

    expect(checkoutIdempotencyKey(NONCE, typed)).toBe(checkoutIdempotencyKey(NONCE, clean));
  });

  it("keeps two buyers with identical baskets apart", () => {
    expect(checkoutIdempotencyKey("other-nonce", BASKET)).not.toBe(
      checkoutIdempotencyKey(NONCE, BASKET),
    );
  });
});
