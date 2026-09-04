import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Writing a review.
 *
 * Buyers are guests — there is no buyer auth anywhere in this product — so a
 * review cannot be an RLS insert by an authenticated user, and `product_reviews`
 * deliberately has no insert policy at all. The only credential a buyer holds is
 * their order's `tracking_token`, so that is what is checked here, server-side,
 * with the admin client.
 *
 * Three things must be true before a row is written, and together they are what
 * makes a SnapDuka review mean something:
 *
 *   1. The token matches a real order.
 *   2. That order actually contained the product being reviewed.
 *   3. The order was paid for, or settled in cash on collection. An abandoned
 *      checkout is not a customer.
 */

export type SubmitReviewInput = {
  trackingToken: string;
  productId: string;
  rating: number;
  body?: string | null;
  /** Falls back to the name captured at checkout. */
  authorName?: string | null;
};

export type SubmitReviewResult =
  | { ok: true; reviewId: string }
  | {
      ok: false;
      reason: "not_found" | "not_purchased" | "not_paid" | "duplicate" | "invalid" | "failed";
      message: string;
    };

/**
 * Payment states that mean money actually changed hands. A cash order becomes
 * `paid` when the seller confirms collection, so there is no separate offline
 * state to allow here. `partially_refunded` still describes someone who bought
 * and received the item; a fully `refunded` order does not.
 */
const PAID_STATES = new Set(["paid", "partially_refunded"]);

export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const rating = Math.trunc(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, reason: "invalid", message: "Choose a rating between 1 and 5 stars." };
  }
  const body = input.body?.trim() || null;
  if (body && body.length > 2000) {
    return { ok: false, reason: "invalid", message: "Please keep your review under 2000 characters." };
  }

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, shop_id, seller_account_id, customer_id, payment_status, buyer_snapshot")
    .eq("tracking_token", input.trackingToken)
    .maybeSingle();

  if (!order) {
    return { ok: false, reason: "not_found", message: "We couldn't find that order." };
  }

  if (!PAID_STATES.has(order.payment_status)) {
    return {
      ok: false,
      reason: "not_paid",
      message: "You can review an order once it has been paid for.",
    };
  }

  // The product must actually have been in this order — otherwise the token for
  // any one order would let someone review the seller's whole catalogue.
  const { count: lineCount } = await admin
    .from("order_lines")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("product_id", input.productId);

  if (!lineCount) {
    return {
      ok: false,
      reason: "not_purchased",
      message: "That item wasn't part of this order.",
    };
  }

  const snapshot = order.buyer_snapshot as { name?: string } | null;
  const authorName = input.authorName?.trim() || snapshot?.name?.trim() || "Verified buyer";

  const { data: review, error } = await admin
    .from("product_reviews")
    .insert({
      seller_account_id: order.seller_account_id,
      shop_id: order.shop_id,
      product_id: input.productId,
      order_id: order.id,
      customer_id: order.customer_id,
      author_name: authorName,
      rating,
      body,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is the (order_id, product_id) uniqueness rule: one review per item
    // per order, so a double submit is not an error worth alarming anyone about.
    if (error.code === "23505") {
      return {
        ok: false,
        reason: "duplicate",
        message: "You've already reviewed this item.",
      };
    }
    return { ok: false, reason: "failed", message: "Your review could not be saved." };
  }

  return { ok: true, reviewId: review.id };
}
