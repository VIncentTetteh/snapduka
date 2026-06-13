import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ orderId: z.uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders")
    .select("id,seller_account_id,total_minor,currency,buyer_snapshot,tracking_token,payment_method,payment_status")
    .eq("id", parsed.data.orderId).maybeSingle();
  if (!order || order.payment_method !== "paystack" || order.payment_status === "paid") {
    return NextResponse.json({ error: "Order is not eligible for payment." }, { status: 409 });
  }
  const { data: subaccount } = await admin.from("payment_subaccounts")
    .select("provider_subaccount_code").eq("seller_account_id", order.seller_account_id)
    .eq("provider", "paystack").eq("status", "active").maybeSingle();
  if (!subaccount?.provider_subaccount_code) {
    return NextResponse.json({ error: "This seller cannot accept online payments yet." }, { status: 409 });
  }
  const reference = `sd_${order.id.replaceAll("-", "").slice(0, 12)}_${randomUUID().slice(0, 8)}`;
  const { data: attempt, error } = await admin.from("payment_attempts").insert({
    order_id: order.id, seller_account_id: order.seller_account_id, reference,
    amount_minor: order.total_minor, currency: order.currency, status: "pending",
  }).select("id").single();
  if (error || !attempt) return NextResponse.json({ error: "Payment could not be started." }, { status: 500 });
  try {
    const result = await paystackProvider().initialize({
      email: String(order.buyer_snapshot.email),
      amountMinor: order.total_minor,
      currency: order.currency,
      reference,
      subaccount: subaccount.provider_subaccount_code,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/orders/${order.tracking_token}?payment=pending`,
      metadata: { orderId: order.id, attemptId: attempt.id },
    });
    return NextResponse.json(result);
  } catch {
    await admin.from("payment_attempts").update({ status: "failed" }).eq("id", attempt.id);
    return NextResponse.json({ error: "Paystack is temporarily unavailable. Retry or choose offline payment." }, { status: 502 });
  }
}
