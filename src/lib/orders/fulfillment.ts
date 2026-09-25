import {
  canTransitionFulfillment,
  type FulfillmentOnlyStep,
  type FulfillmentState,
} from "@/lib/commerce/transitions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Advancing fulfilment on its own — dispatch, ready-for-pickup, return — the
 * steps that have no order-status counterpart and so cannot go through
 * `transitionOrder`.
 *
 * Same contract as `transitionOrder`: admin client with an explicit
 * seller_account_id filter for ownership, an `event_version` compare-and-set
 * for concurrency, and loud-but-non-fatal post-commit side effects. Before this
 * existed, the public fulfilment API wrote `fulfillment_status` directly: no
 * guard, no version, no order event, no buyer notification.
 */

/**
 * `fulfilled` is only accepted from a courier: a third party reporting the
 * parcel arrived is evidence, whereas a seller claiming it is not — sellers
 * reach `fulfilled` by completing the order through `transitionOrder`.
 */
export type FulfillmentStep = FulfillmentOnlyStep | "fulfilled";

export type FulfillmentInput = {
  sellerAccountId: string;
  orderId: string;
  next: FulfillmentStep;
  /**
   * The `event_version` the caller last saw. Mismatch means someone else won.
   * Omitted only by machine callers (courier webhooks) that never read the
   * order; the compare-and-set then guards against the read-to-write race.
   */
  expectedVersion?: number;
  /** Where the change came from, kept on the order event for support. */
  source: "api" | "dashboard" | "mobile" | "booking" | "courier";
  /** Extra detail recorded on the order event, e.g. tracking number. */
  detail?: Record<string, string | null>;
};

export type FulfillmentFailure =
  | "not_found"
  | "version_conflict"
  | "illegal_transition"
  | "protect_awaiting_buyer";

export type FulfillmentResult =
  | { ok: true; orderId: string; fulfillmentStatus: FulfillmentStep; version: number }
  | { ok: false; reason: FulfillmentFailure };

export async function advanceFulfillment(input: FulfillmentInput): Promise<FulfillmentResult> {
  const { sellerAccountId, orderId, next, source, detail } = input;
  if (next === "fulfilled" && source !== "courier") {
    return { ok: false, reason: "illegal_transition" };
  }
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id,status,fulfillment_status,event_version,protection_mode")
    .eq("id", orderId)
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();

  if (!order) return { ok: false, reason: "not_found" };
  const expectedVersion = input.expectedVersion ?? order.event_version;
  if (order.event_version !== expectedVersion) return { ok: false, reason: "version_conflict" };
  // A paid order is confirmed as a sale while its fulfilment still reads
  // `unconfirmed` (payment capture moves order status, not fulfilment), so for
  // the purpose of what may happen next it is a confirmed order.
  const from = (
    order.fulfillment_status === "unconfirmed" && ["confirmed", "processing"].includes(order.status)
      ? "confirmed"
      : order.fulfillment_status
  ) as FulfillmentState;

  // For a protected order a courier's "delivered" is evidence, not the release
  // of the buyer's money: it shortens the timeout and the buyer's confirmation
  // (or that timeout) completes the order.
  if (next === "fulfilled" && order.protection_mode === "protect") {
    const { error: evidenceError } = await admin.rpc("record_courier_delivery", {
      p_order_id: orderId,
    });
    if (evidenceError) {
      console.error(`[orders/fulfillment] record_courier_delivery failed for ${orderId}`, evidenceError);
    }
    return { ok: false, reason: "protect_awaiting_buyer" };
  }
  if (!canTransitionFulfillment(from, next)) return { ok: false, reason: "illegal_transition" };

  const previous = order.fulfillment_status;
  const nextVersion = expectedVersion + 1;
  const { data: changed } = await admin
    .from("orders")
    .update({ fulfillment_status: next, event_version: nextVersion })
    .eq("id", orderId)
    .eq("event_version", expectedVersion)
    .select("id")
    .maybeSingle();
  if (!changed) return { ok: false, reason: "version_conflict" };

  // Post-commit: the change is durable, so failures below are logged rather
  // than surfaced — a retry would only come back as a version conflict.
  const { error: eventError } = await admin.from("order_events").insert({
    order_id: orderId,
    seller_account_id: sellerAccountId,
    event_type: `fulfillment_${next}`,
    // A courier is a provider acting on its own; attributing its report to
    // the seller would make the seller look responsible for the delivery claim.
    actor_type: source === "courier" ? "provider" : "seller",
    actor_id: source === "courier" ? null : sellerAccountId,
    buyer_visible: true,
    data: { from: previous, to: next, source, ...detail },
  });
  if (eventError) {
    console.error(`[orders/fulfillment] order_events insert failed for ${orderId}`, eventError);
  }

  const { error: notifyError } = await admin.rpc("enqueue_order_notification", {
    p_order_id: orderId,
    p_event: next,
  });
  if (notifyError) {
    console.error(
      `[orders/fulfillment] enqueue_order_notification failed for ${orderId}`,
      notifyError,
    );
  }

  return { ok: true, orderId, fulfillmentStatus: next, version: nextVersion };
}
