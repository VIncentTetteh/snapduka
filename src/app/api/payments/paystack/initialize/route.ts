import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { paystackProvider } from "@/lib/payments/paystack";
import { checkRateLimit } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { jsonObject } from "@/lib/db/json";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The tracking token is required, not just the order id.
 *
 * This took an order UUID and nothing else. It then built a Paystack page
 * prefilled with that buyer's email and a callback URL containing the order's
 * tracking_token — and the tracking token is the capability that opens
 * /orders/<token>, with the buyer's name, phone, address and items on it. So an
 * order id could be exchanged for the secret that an order id is not supposed
 * to be equivalent to.
 *
 * The buyer who just placed the order has the token: /api/checkout/orders
 * returns it, and the checkout form already holds it to redirect afterwards.
 * Anyone who merely knows or guesses an id does not.
 */
const schema = z.object({ orderId: z.uuid(), trackingToken: z.uuid() });

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
  const rl = await checkRateLimit(`paystack:init:${ip}`, PAYSTACK_LIMIT);
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
    // Both, so knowing the id alone gets nothing. Same 409 either way: a
    // wrong token must not be distinguishable from an ineligible order.
    .eq("tracking_token", parsed.data.trackingToken)
    .maybeSingle();

  if (!order || order.payment_method !== "paystack" || order.payment_status === "paid") {
    return NextResponse.json({ error: "Order is not eligible for payment." }, { status: 409 });
  }

  // Under settlement_mode='ledger' the full amount lands in SnapDuka's main
  // account and the seller is credited internally, so no split is sent and no
  // subaccount is needed. The legacy mode still requires one, because there the
  // subaccount IS how the seller gets paid.
  const { data: seller } = await admin
    .from("seller_accounts")
    .select("country")
    .eq("id", order.seller_account_id)
    .maybeSingle();
  const { data: countryConfig } = await admin
    .from("country_configs")
    .select("settlement_mode")
    .eq("country", seller?.country ?? "GH")
    .maybeSingle();
  const onLedger = countryConfig?.settlement_mode === "ledger";

  let subaccountCode: string | undefined;
  if (!onLedger) {
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
    subaccountCode = subaccount.provider_subaccount_code;
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

  // Paystack settles in GHS and NGN only. An XOF order reaching here would be
  // rejected by the provider with a currency error the buyer cannot act on;
  // Cote d'Ivoire has no online payment rail yet and checkout says so.
  if (order.currency !== "GHS" && order.currency !== "NGN") {
    return NextResponse.json(
      { error: "Online payment is not available in this market yet." },
      { status: 400 },
    );
  }

  // buyer_snapshot is jsonb, so the generated type is the full Json union.
  const buyer = jsonObject(order.buyer_snapshot);

  try {
    const result = await paystackProvider().initialize({
      email: String(buyer.email),
      amountMinor: order.total_minor,
      currency: order.currency,
      reference,
      subaccount: subaccountCode,
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
