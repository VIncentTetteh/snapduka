import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ orderId: z.uuid(), amountMinor: z.number().int().positive().optional() });

export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" && actor.kind !== "operator") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid refund." }, { status: 400 });
  const admin = createAdminClient();
  let query = admin.from("orders").select("id,seller_account_id,total_minor,payment_status").eq("id", parsed.data.orderId);
  if (actor.kind === "seller") query = query.eq("seller_account_id", actor.sellerAccountId);
  const { data: order } = await query.maybeSingle();
  if (!order || order.payment_status !== "paid") return NextResponse.json({ error: "Order is not refundable." }, { status: 409 });
  const { data: attempt } = await admin.from("payment_attempts").select("id,reference").eq("order_id", order.id).eq("status", "paid").maybeSingle();
  if (!attempt) return NextResponse.json({ error: "Paid attempt not found." }, { status: 409 });
  const amount = parsed.data.amountMinor ?? order.total_minor;
  if (amount > order.total_minor) return NextResponse.json({ error: "Amount exceeds paid balance." }, { status: 400 });
  const result = await paystackProvider().refund({ reference: attempt.reference, amountMinor: amount });
  await admin.from("refunds").insert({
    order_id: order.id, payment_attempt_id: attempt.id, seller_account_id: order.seller_account_id,
    amount_minor: amount, provider_refund_id: result.providerId, status: "processing",
  });
  return NextResponse.json({ status: "processing" }, { status: 202 });
}
