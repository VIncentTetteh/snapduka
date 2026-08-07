import { z } from "zod";

import { SELLER_TRANSITIONS } from "@/lib/commerce/transitions";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { transitionOrder } from "@/lib/orders/transition";

/**
 * Advance one order's status from the mobile app.
 *
 * `orders` has no UPDATE grant for `authenticated` and there is no transition
 * RPC, so the device cannot do this directly — before this route existed, the
 * app's status buttons called `.update()` and failed silently.
 */

const schema = z.object({
  status: z.enum(SELLER_TRANSITIONS),
  /**
   * The `event_version` the app last read. Required, not optional: without it
   * two people working the same order would overwrite each other, and the app
   * would show whichever write landed last as if it were the only one.
   */
  expectedVersion: z.number().int().nonnegative(),
  /** Confirms cash was collected, for an order whose payment is offline_due. */
  offlinePaidConfirmed: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const actor = await requireSeller("orders.manage");
  if (isResponse(actor)) return actor;

  const limited = await enforceRateLimit("orders.transition", actor.sellerAccountId, {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  const { orderId } = await context.params;
  if (!z.uuid().safeParse(orderId).success) {
    return fail("not_found", "That order does not exist.");
  }

  try {
    const result = await transitionOrder({
      sellerAccountId: actor.sellerAccountId,
      orderId,
      next: body.status,
      expectedVersion: body.expectedVersion,
      offlinePaidConfirmed: body.offlinePaidConfirmed,
    });

    if (result.ok) {
      return ok({ order: { id: result.orderId, status: result.status, version: result.version } });
    }

    switch (result.reason) {
      case "not_found":
        return fail("not_found", "That order does not exist.");
      case "version_conflict":
        // The client must refetch and re-present the choice; retrying blind
        // would apply a decision the seller made against stale information.
        return fail("version_conflict", "This order changed. Refresh and try again.");
      case "illegal_transition":
        return fail("conflict", "That is not a valid next step for this order.");
      case "offline_unconfirmed":
        return fail("conflict", "Confirm you collected payment before completing this order.");
    }
  } catch (error) {
    return failUnexpected("orders.transition", error);
  }
}
