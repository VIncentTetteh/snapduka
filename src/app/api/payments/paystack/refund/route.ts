import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { startRefund, type StartRefundResult } from "@/lib/payments/refunds";

const schema = z.object({ orderId: z.uuid(), amountMinor: z.number().int().positive().optional() });

/**
 * Refund an order.
 *
 * Two things were wrong here and both moved money.
 *
 * The gate was `kind !== "seller" && kind !== "operator"` with no permission
 * check. `resolveServerActor` hands a team member `kind: "seller"` carrying the
 * owner's account id, so any role — including `analyst`, which does not even
 * hold `orders.manage` — could refund. Every comparable money route checks a
 * permission.
 *
 * And Paystack was called *before* the local `refunds` row was written, with
 * that insert's error discarded. The prior-refund total that decides how much
 * is still refundable reads those rows, so a failed or lost insert left the
 * same amount refundable again — a second full refund, with nothing recording
 * the first. The row is now claimed first, at `requested`, which is a status
 * the balance query counts; the provider result only updates it. A partial
 * unique index makes two in-flight refunds on one order impossible rather than
 * merely unlikely, since read-committed lets two concurrent callers both miss
 * each other's uncommitted claim.
 */
const FAILURES: Record<Extract<StartRefundResult, { ok: false }>["reason"], [string, number]> = {
  not_refundable: ["Order is not refundable.", 409],
  no_paid_attempt: ["Paid attempt not found.", 409],
  fully_refunded: ["Order is already fully refunded.", 409],
  amount_too_large: ["Amount exceeds the unrefunded balance.", 400],
  in_flight: ["A refund is already in progress for this order.", 409],
  claim_failed: ["Could not start the refund.", 500],
  provider_failed: ["The refund could not be sent. Try again.", 502],
};

export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" && actor.kind !== "operator") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (actor.kind === "seller" && !hasPermission(actor.role ?? "owner", "orders.manage")) {
    return NextResponse.json({ error: "Your role cannot refund orders." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid refund." }, { status: 400 });

  const result = await startRefund({
    orderId: parsed.data.orderId,
    sellerAccountId: actor.kind === "seller" ? actor.sellerAccountId : undefined,
    amountMinor: parsed.data.amountMinor,
  });
  if (!result.ok) {
    const [error, status] = FAILURES[result.reason];
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json({ status: "processing" }, { status: 202 });
}
