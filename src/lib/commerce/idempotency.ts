/**
 * The checkout idempotency key.
 *
 * `create_guest_order` returns the cached order when it sees a key it has
 * already used. That is exactly right for a retry — a flaky network, a
 * double-tap, a second payment attempt — and exactly wrong if the order has
 * changed underneath it.
 *
 * The key used to be a bare per-mount UUID, so it survived the buyer changing
 * their mind. After a failed payment attempt, a buyer who switched to a cheaper
 * delivery method, lowered a quantity or typed a promo code got the *original*
 * order back, and `paystack/initialize` charged its total rather than the one
 * on screen.
 *
 * So the key is the nonce plus a digest of everything that defines what is
 * being bought. Same order twice ⇒ same key ⇒ one order. Different order ⇒
 * different key ⇒ a different order, which is what it now is.
 */

export type CheckoutContents = {
  fulfillmentMethodId: string;
  paymentMethod: string;
  promotionCode: string;
  lines: { productId: string; variantId: string | null; quantity: number }[];
};

/**
 * Order-insensitive, case-insensitive on the promo code, so trivial
 * differences do not mint a second order for the same basket.
 */
function fingerprint(contents: CheckoutContents): string {
  return JSON.stringify({
    method: contents.fulfillmentMethodId,
    payment: contents.paymentMethod,
    promotionCode: contents.promotionCode.trim().toUpperCase(),
    lines: contents.lines
      .map((line) => `${line.productId}:${line.variantId ?? "base"}:${line.quantity}`)
      .sort(),
  });
}

/** Not a security boundary — a short stable digest of the basket. */
function digest(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function checkoutIdempotencyKey(nonce: string, contents: CheckoutContents): string {
  return `checkout-${nonce}-${digest(fingerprint(contents))}`;
}
