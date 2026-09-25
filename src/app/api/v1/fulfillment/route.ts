import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApi } from "@/lib/api-keys/auth";
import { isFulfillmentOnlyStep, type SellerTransition } from "@/lib/commerce/transitions";
import { advanceFulfillment, type FulfillmentFailure } from "@/lib/orders/fulfillment";
import { transitionOrder, type TransitionFailure } from "@/lib/orders/transition";

/**
 * Public fulfilment API.
 *
 * This used to write `fulfillment_status` straight onto the order. That skipped
 * the state machine, the event_version compare-and-set, stock finalisation, the
 * order event and the buyer notification — and because the payout hold starts
 * when an order is fulfilled, one API call could start the clock on money for a
 * parcel that never left.
 *
 * Now every status goes through the same code the dashboard and the app use:
 * statuses with an order-status counterpart go through `transitionOrder`, and
 * the fulfilment-only steps go through `advanceFulfillment`.
 *
 * Contract: send `expectedVersion` (the order's `event_version`, returned by
 * GET /api/v1/orders); the response carries the new version. Integrations
 * written before this existed do not send it, so for a deprecation period a
 * missing version is filled from the order's current one and the response
 * says so in `Deprecation` / `Warning` headers. Such a call is still guarded
 * by the state machine and the compare-and-set; it only loses protection
 * against a concurrent change the caller never saw.
 */

/** Fulfilment status an integrator sends → the order transition that sets it. */
const ORDER_TRANSITION_FOR: Partial<Record<string, SellerTransition>> = {
  confirmed: "confirmed",
  preparing: "processing",
  fulfilled: "completed",
  cancelled: "cancelled",
};

const schema = z.object({
  orderId: z.uuid(),
  status: z.enum([
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "dispatched",
    "fulfilled",
    "cancelled",
    "returned",
  ]),
  expectedVersion: z.number().int().nonnegative().optional(),
  /** Confirms cash was collected, required to fulfil an order paid on delivery. */
  offlinePaidConfirmed: z.boolean().optional(),
});

const FAILURES: Record<FulfillmentFailure | TransitionFailure, [number, string]> = {
  not_found: [404, "Order not found."],
  version_conflict: [409, "This order changed. Fetch it again and retry."],
  illegal_transition: [409, "That is not a valid next step for this order."],
  offline_unconfirmed: [409, "Set offlinePaidConfirmed to fulfil an order paid on delivery."],
  protect_pending_delivery: [409, "Protected order: it is fulfilled when the buyer confirms delivery."],
  protect_awaiting_buyer: [409, "Protected order: it is fulfilled when the buyer confirms delivery."],
};

function failure(reason: FulfillmentFailure | TransitionFailure) {
  const [status, error] = FAILURES[reason];
  return NextResponse.json({ error, code: reason }, { status });
}

export async function POST(request: Request) {
  const auth = await authenticateApi(request, "fulfillment:write");
  if (!auth) return NextResponse.json({ error: "Unauthorized or rate limited." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fulfillment update." }, { status: 400 });
  }

  const { orderId, status, offlinePaidConfirmed } = parsed.data;
  const sellerAccountId = auth.key.seller_account_id;

  const deprecatedCall = parsed.data.expectedVersion === undefined;
  let expectedVersion = parsed.data.expectedVersion;
  if (expectedVersion === undefined) {
    const { data: current } = await auth.admin
      .from("orders")
      .select("event_version")
      .eq("id", orderId)
      .eq("seller_account_id", sellerAccountId)
      .maybeSingle();
    if (!current) return failure("not_found");
    expectedVersion = current.event_version;
  }
  const orderTransition = ORDER_TRANSITION_FOR[status];

  let result;
  if (orderTransition) {
    result = await transitionOrder({
      sellerAccountId,
      orderId,
      next: orderTransition,
      expectedVersion,
      offlinePaidConfirmed,
    });
  } else if (isFulfillmentOnlyStep(status)) {
    result = await advanceFulfillment({
      sellerAccountId,
      orderId,
      next: status,
      expectedVersion,
      source: "api",
    });
  } else {
    // Unreachable while the schema and the two tables above cover every
    // status; fail closed if someone adds a status to one and not the others.
    return failure("illegal_transition");
  }

  const headers: Record<string, string> = deprecatedCall
    ? {
        Deprecation: "true",
        Warning: '299 - "expectedVersion will be required; send the order\'s event_version from GET /api/v1/orders"',
      }
    : {};
  if (!result.ok) {
    const response = failure(result.reason);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  return NextResponse.json(
    { data: { id: result.orderId, fulfillment_status: status, event_version: result.version } },
    { headers },
  );
}
