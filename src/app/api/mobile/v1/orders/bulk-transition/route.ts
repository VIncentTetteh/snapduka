import { z } from "zod";

import { SELLER_TRANSITIONS } from "@/lib/commerce/transitions";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { failUnexpected, ok } from "@/lib/mobile/response";
import { BULK_LIMIT, bulkTransitionOrders } from "@/lib/orders/transition";

/**
 * Advance several orders at once.
 *
 * Partial success is the normal case — one order in the selection may have been
 * changed on another device since the list was loaded — so this returns 200
 * with a per-order outcome rather than failing the batch. The client shows what
 * went through and what needs another look.
 */

const schema = z.object({
  orderIds: z.array(z.uuid()).min(1).max(BULK_LIMIT),
  status: z.enum(SELLER_TRANSITIONS),
  offlinePaidConfirmed: z.boolean().optional(),
});

export async function POST(request: Request) {
  const actor = await requireSeller("orders.manage");
  if (isResponse(actor)) return actor;

  const limited = await enforceRateLimit("orders.bulk", actor.sellerAccountId, {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const outcomes = await bulkTransitionOrders({
      sellerAccountId: actor.sellerAccountId,
      orderIds: body.orderIds,
      next: body.status,
      offlinePaidConfirmed: body.offlinePaidConfirmed,
    });

    return ok({
      results: outcomes.map(({ orderId, result }) =>
        result.ok
          ? { orderId, ok: true as const, status: result.status, version: result.version }
          : { orderId, ok: false as const, reason: result.reason },
      ),
      applied: outcomes.filter((o) => o.result.ok).length,
    });
  } catch (error) {
    return failUnexpected("orders.bulk", error);
  }
}
