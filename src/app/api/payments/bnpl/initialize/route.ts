import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { bnplRouteReason } from "@/lib/bnpl/capture";
import { getActiveBnplProvider } from "@/lib/bnpl/registry";
import { jsonObject } from "@/lib/db/json";
import { recordPaymentOutcome, routeCheckout } from "@/lib/payments/providers/router";
import { settlementModeFor } from "@/lib/protect/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Starts a "pay in instalments" checkout with the BNPL partner (flag `bnpl`,
 * ADR-0014). The buyer chose it explicitly, so this is its own route rather
 * than a branch of /api/payments/paystack/initialize, and it has no fallback:
 * if the partner cannot start, the buyer is told and picks another way to pay.
 * Silently sending someone who asked to pay later to a pay-now page — or the
 * reverse — is not a fallback, it is a different purchase.
 *
 * Same capability rule as the Paystack route: the order id AND its tracking
 * token, so knowing an id alone gets nothing.
 *
 * Ledger sellers only. The partner pays SnapDuka the full total and the seller
 * is credited through the ordinary capture; under the legacy subaccount split
 * there is no SnapDuka balance for the partner's money to land in.
 */
const schema = z.object({ orderId: z.uuid(), trackingToken: z.uuid() });

const BNPL_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? request.headers.get("x-real-ip") ?? "unknown"
  );
}

export async function POST(request: Request) {
  const rl = await checkRateLimit(`bnpl:init:${clientIp(request)}`, BNPL_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many payment requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order." }, { status: 400 });

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id,seller_account_id,total_minor,currency,buyer_snapshot,tracking_token,payment_method,payment_status")
    .eq("id", parsed.data.orderId)
    .eq("tracking_token", parsed.data.trackingToken)
    .maybeSingle();

  if (!order || order.payment_method !== "paystack" || order.payment_status === "paid") {
    return NextResponse.json({ error: "Order is not eligible for payment." }, { status: 409 });
  }
  if (order.currency !== "GHS" && order.currency !== "NGN") {
    return NextResponse.json({ error: "Pay later is not available in this market." }, { status: 409 });
  }
  if ((await settlementModeFor(order.seller_account_id)) !== "ledger") {
    return NextResponse.json({ error: "This shop does not offer pay later." }, { status: 409 });
  }

  const country = order.currency === "GHS" ? "GH" : "NG";
  const [route] = await routeCheckout({
    country,
    currency: order.currency,
    sellerAccountId: order.seller_account_id,
    method: "bnpl",
  });
  if (!route) {
    return NextResponse.json(
      { error: "Pay later is not available for this order. Choose another way to pay." },
      { status: 409 },
    );
  }

  const partner = getActiveBnplProvider();
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
      provider: route.provider.id,
      // Binds the attempt to this partner: only its signed webhook can capture it.
      route_reason: bnplRouteReason(partner.id),
    })
    .select("id")
    .single();
  if (error || !attempt) {
    return NextResponse.json({ error: "Payment could not be started." }, { status: 500 });
  }

  const buyer = jsonObject(order.buyer_snapshot);
  try {
    const result = await route.provider.adapter().initialize({
      email: String(buyer.email),
      amountMinor: order.total_minor,
      currency: order.currency,
      reference,
      callbackUrl: `${await appOrigin()}/orders/${order.tracking_token}?payment=pending`,
      metadata: { orderId: order.id, attemptId: attempt.id, method: "bnpl" },
    });
    await recordPaymentOutcome(route.provider.id, country, true);
    return NextResponse.json(result);
  } catch {
    await admin.from("payment_attempts").update({ status: "failed" }).eq("id", attempt.id);
    await recordPaymentOutcome(route.provider.id, country, false);
    return NextResponse.json(
      { error: "Pay later could not be started. Choose another way to pay, or retry." },
      { status: 502 },
    );
  }
}
