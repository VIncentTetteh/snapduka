import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ orderId: z.uuid(), amountMinor: z.number().int().positive().optional() });

function mapInitialRefundStatus(providerStatus: string): "processing" | "completed" | "failed" {
  if (providerStatus === "processed") return "completed";
  if (providerStatus === "failed") return "failed";
  return "processing";
}

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

  const admin = createAdminClient();
  let query = admin
    .from("orders")
    .select("id,seller_account_id,total_minor,payment_status")
    .eq("id", parsed.data.orderId);
  if (actor.kind === "seller") query = query.eq("seller_account_id", actor.sellerAccountId);
  const { data: order } = await query.maybeSingle();
  if (!order || order.payment_status !== "paid") {
    return NextResponse.json({ error: "Order is not refundable." }, { status: 409 });
  }

  // An order with two paid attempts would make maybeSingle() error into null
  // and report "not found", which is misleading — take the most recent instead.
  const { data: attempts } = await admin
    .from("payment_attempts")
    .select("id,reference")
    .eq("order_id", order.id)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1);
  const attempt = attempts?.[0];
  if (!attempt) return NextResponse.json({ error: "Paid attempt not found." }, { status: 409 });

  const { data: priorRefunds } = await admin
    .from("refunds")
    .select("amount_minor")
    .eq("order_id", order.id)
    .neq("status", "failed");
  const alreadyRefundedMinor = (priorRefunds ?? []).reduce((sum, row) => sum + row.amount_minor, 0);
  const remainingMinor = order.total_minor - alreadyRefundedMinor;
  if (remainingMinor <= 0) {
    return NextResponse.json({ error: "Order is already fully refunded." }, { status: 409 });
  }

  const amount = parsed.data.amountMinor ?? remainingMinor;
  if (amount > remainingMinor) {
    return NextResponse.json({ error: "Amount exceeds the unrefunded balance." }, { status: 400 });
  }

  // Claim the amount before spending it. `requested` counts toward the balance
  // above, so a concurrent caller cannot also claim it.
  const { data: claimed, error: claimError } = await admin
    .from("refunds")
    .insert({
      order_id: order.id,
      payment_attempt_id: attempt.id,
      seller_account_id: order.seller_account_id,
      amount_minor: amount,
      status: "requested",
    })
    .select("id")
    .single();

  if (claimError || !claimed) {
    // 23505 is the in-flight index: someone else is already refunding this order.
    const conflict = claimError?.code === "23505";
    return NextResponse.json(
      { error: conflict ? "A refund is already in progress for this order." : "Could not start the refund." },
      { status: conflict ? 409 : 500 },
    );
  }

  try {
    const result = await paystackProvider().refund({
      reference: attempt.reference,
      amountMinor: amount,
    });
    await admin
      .from("refunds")
      .update({
        provider_refund_id: result.providerId,
        status: mapInitialRefundStatus(result.status),
      })
      .eq("id", claimed.id);
  } catch (error) {
    // Release the claim so the amount is refundable again — `failed` is the one
    // status the balance query excludes.
    await admin.from("refunds").update({ status: "failed" }).eq("id", claimed.id);
    console.error("[refund] provider call failed", { orderId: order.id, error });
    return NextResponse.json({ error: "The refund could not be sent. Try again." }, { status: 502 });
  }

  const { error: orderError } = await admin
    .from("orders")
    .update({ refund_status: "processing" })
    .eq("id", order.id)
    .eq("refund_status", "none");
  if (orderError) {
    // The money is already moving, so this is not a failure to report to the
    // caller — but it must not vanish: refund_status gates settlement release.
    console.error("[refund] order refund_status not updated", { orderId: order.id, error: orderError });
  }

  return NextResponse.json({ status: "processing" }, { status: 202 });
}
