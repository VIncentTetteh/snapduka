import {
  canTransitionOrder,
  fulfillmentForTransition,
  type OrderState,
  type SellerTransition,
} from "@/lib/commerce/transitions";
import { enqueueIntegrationEvent } from "@/lib/integrations/events";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Advancing an order's status, shared by the dashboard server action and the
 * mobile API route.
 *
 * This has to run with the admin client: `orders` has a SELECT policy only —
 * no UPDATE grant for `authenticated` — and `finalize_order_stock` and
 * `enqueue_order_notification` are both revoked from `authenticated`
 * (202608010065_revoke_public_rpc_execute.sql). Ownership is enforced here with
 * an explicit seller_account_id filter, and concurrency with the
 * `event_version` compare-and-set that the caller must supply.
 *
 * Callers are adapters: the server action maps FormData in and revalidates
 * paths out; the route handler maps JSON in and an error envelope out. Neither
 * holds any of the rules below.
 */

/** Matches the cap the dashboard's bulk action has always applied. */
export const BULK_LIMIT = 100;

export type TransitionInput = {
  sellerAccountId: string;
  orderId: string;
  next: SellerTransition;
  /** The `event_version` the caller last saw. Mismatch means someone else won. */
  expectedVersion: number;
  /**
   * Explicit confirmation that cash was collected, required to complete an
   * order whose payment_status is `offline_due`. Without it, completing would
   * silently mark an unpaid order paid.
   */
  offlinePaidConfirmed?: boolean;
};

export type TransitionFailure =
  | "not_found"
  | "version_conflict"
  | "illegal_transition"
  | "offline_unconfirmed";

export type TransitionResult =
  | { ok: true; orderId: string; status: SellerTransition; version: number }
  | { ok: false; reason: TransitionFailure };

export async function transitionOrder(input: TransitionInput): Promise<TransitionResult> {
  const { sellerAccountId, orderId, next, expectedVersion, offlinePaidConfirmed } = input;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id,status,event_version,payment_status,customer_id,public_reference,total_minor,currency",
    )
    .eq("id", orderId)
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();

  if (!order) return { ok: false, reason: "not_found" };
  if (order.event_version !== expectedVersion) return { ok: false, reason: "version_conflict" };
  if (!canTransitionOrder(order.status, next as OrderState)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (next === "completed" && order.payment_status === "offline_due" && !offlinePaidConfirmed) {
    return { ok: false, reason: "offline_unconfirmed" };
  }

  const nextVersion = expectedVersion + 1;
  const updates: Record<string, unknown> = {
    status: next,
    event_version: nextVersion,
    fulfillment_status: fulfillmentForTransition(next),
  };
  if (next === "completed" && order.payment_status === "offline_due") {
    updates.payment_status = "paid";
  }

  // Compare-and-set on event_version: if another client advanced this order
  // between the read above and here, zero rows change and we report a conflict
  // rather than overwriting their work.
  const { data: changed } = await admin
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .eq("event_version", expectedVersion)
    .select("id")
    .maybeSingle();
  if (!changed) return { ok: false, reason: "version_conflict" };

  if (next === "completed") {
    await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "consumed" });
  }
  if (next === "cancelled") {
    await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "released" });
  }

  await admin.from("order_events").insert({
    order_id: orderId,
    seller_account_id: sellerAccountId,
    event_type: `order_${next}`,
    actor_type: "seller",
    actor_id: sellerAccountId,
    data: { from: order.status, to: next },
  });

  await admin.rpc("enqueue_order_notification", { p_order_id: orderId, p_event: next });

  if (next === "completed") {
    await enqueueIntegrationEvent({
      data: {
        currency: order.currency,
        customerId: order.customer_id,
        orderId,
        reference: order.public_reference,
        totalMinor: order.total_minor,
      },
      eventId: `${orderId}:${nextVersion}:completed`,
      eventType: "order.completed",
      sellerAccountId,
    });
  }

  return { ok: true, orderId, status: next, version: nextVersion };
}

export type BulkTransitionOutcome = {
  orderId: string;
  result: TransitionResult;
};

/**
 * Apply the same transition to many orders, each with its own current version.
 *
 * Runs sequentially and reuses `transitionOrder` per order, which is a
 * behaviour change worth stating: the previous bulk path wrote only `status`
 * and `event_version`, so it left `fulfillment_status` stale, recorded no
 * `order_events` row, and never notified the buyer. Bulk-completing ten orders
 * told nobody. Now bulk and single do exactly the same thing.
 */
export async function bulkTransitionOrders(input: {
  sellerAccountId: string;
  orderIds: string[];
  next: SellerTransition;
  offlinePaidConfirmed?: boolean;
}): Promise<BulkTransitionOutcome[]> {
  const admin = createAdminClient();
  const ids = input.orderIds.slice(0, BULK_LIMIT);

  const { data: orders } = await admin
    .from("orders")
    .select("id,event_version")
    .eq("seller_account_id", input.sellerAccountId)
    .in("id", ids);

  const versions = new Map<string, number>(
    (orders ?? []).map((o: { id: string; event_version: number }) => [o.id, o.event_version]),
  );

  const outcomes: BulkTransitionOutcome[] = [];
  for (const orderId of ids) {
    const expectedVersion = versions.get(orderId);
    if (expectedVersion === undefined) {
      outcomes.push({ orderId, result: { ok: false, reason: "not_found" } });
      continue;
    }
    outcomes.push({
      orderId,
      result: await transitionOrder({
        sellerAccountId: input.sellerAccountId,
        orderId,
        next: input.next,
        expectedVersion,
        offlinePaidConfirmed: input.offlinePaidConfirmed,
      }),
    });
  }
  return outcomes;
}
