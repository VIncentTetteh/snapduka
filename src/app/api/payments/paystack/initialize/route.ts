import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { paystackProvider } from "@/lib/payments/paystack";
import { checkRateLimit } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ orderId: z.uuid() });

// 10 payment initializations per IP per 5 minutes
const PAYSTACK_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = checkRateLimit(`paystack:init:${ip}`, PAYSTACK_LIMIT);
  if (!rl.ok) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many payment requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order." }, { status: 400 });

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(
      "id,seller_account_id,total_minor,currency,buyer_snapshot,tracking_token,payment_method,payment_status",
    )
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!order || order.payment_method !== "paystack" || order.payment_status === "paid") {
    return NextResponse.json({ error: "Order is not eligible for payment." }, { status: 409 });
  }

  const { data: subaccount } = await admin
    .from("payment_subaccounts")
    .select("provider_subaccount_code")
    .eq("seller_account_id", order.seller_account_id)
    .eq("provider", "paystack")
    .eq("status", "active")
    .maybeSingle();

  if (!subaccount?.provider_subaccount_code) {
    return NextResponse.json(
      { error: "This seller cannot accept online payments yet." },
      { status: 409 },
    );
  }

  const reference = `sd_${order.id.replaceAll("-", "").slice(0, 12)}_${randomUUID().slice(0, 8)}`;
  const { data: attempt, error } = await admin
    .from("payment_attempts")
    .insert({
      order_id: order.id,
      seller_account_id: order.seller_account_id,
      reference,
      amount_minor: order.total_minor,
      currency: order.currency,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Payment could not be started." }, { status: 500 });
  }

  try {
    const result = await paystackProvider().initialize({
      email: String(order.buyer_snapshot.email),
      amountMinor: order.total_minor,
      currency: order.currency,
      reference,
      subaccount: subaccount.provider_subaccount_code,
      callbackUrl: `${await appOrigin()}/orders/${order.tracking_token}?payment=pending`,
      metadata: { orderId: order.id, attemptId: attempt.id },
    });
    return NextResponse.json(result);
  } catch {
    await admin.from("payment_attempts").update({ status: "failed" }).eq("id", attempt.id);
    return NextResponse.json(
      { error: "Paystack is temporarily unavailable. Retry or choose offline payment." },
      { status: 502 },
    );
  }
}
