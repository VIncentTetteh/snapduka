import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ reference: z.string().min(8).max(120) });

function periodEnd(start: Date, interval: string): string {
  const end = new Date(start);
  if (interval === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

/**
 * Seller-initiated subscription confirmation, called when Paystack redirects
 * back to the billing page. Verifies the charge and activates the pending
 * subscription — the primary path in local dev (webhooks can't reach
 * localhost) and a safety net in production while the webhook is in flight.
 * The subscription-webhook remains authoritative for renewals and failures.
 */
export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const rl = checkRateLimit(`paystack:sub-verify:${actor.sellerAccountId}`, {
    limit: 10,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reference." }, { status: 400 });
  const reference = parsed.data.reference;
  // References are minted by selectPlan as subscription-{sellerAccountId}-{uuid},
  // so a seller can only ever confirm their own checkout.
  if (!reference.startsWith(`subscription-${actor.sellerAccountId}-`)) {
    return NextResponse.json({ error: "Unknown reference." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("seller_subscriptions")
    .select("id,state,plan_prices(amount_minor,currency,interval)")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!subscription) return NextResponse.json({ error: "No pending subscription." }, { status: 404 });
  if (subscription.state === "active") return NextResponse.json({ state: "active" });

  type PriceRow = { amount_minor: number; currency: string; interval: string };
  const joined = subscription.plan_prices as unknown as PriceRow | PriceRow[] | null;
  const price = Array.isArray(joined) ? joined[0] : joined;
  if (!price) return NextResponse.json({ error: "Subscription has no price." }, { status: 409 });

  let verified;
  try {
    verified = await paystackProvider().verify(reference);
  } catch {
    return NextResponse.json(
      { error: "Payment could not be verified yet. It will confirm automatically." },
      { status: 502 },
    );
  }
  if (verified.status !== "success") {
    return NextResponse.json({ state: subscription.state, providerStatus: verified.status });
  }
  if (verified.amountMinor !== price.amount_minor || verified.currency !== price.currency) {
    return NextResponse.json({ error: "Payment does not match the plan price." }, { status: 409 });
  }

  // event_key is unique — a concurrent webhook or double-submit records once.
  const { error: eventError } = await admin.from("subscription_events").insert({
    subscription_id: subscription.id,
    seller_account_id: actor.sellerAccountId,
    event_key: `verify:${reference}`,
    event_type: "charge.verified",
    payload: { source: "verify", reference, amount: verified.amountMinor, currency: verified.currency },
  });
  if (eventError) {
    // 23505 = this reference was already consumed (earlier verify or the
    // webhook). Never re-apply it: replaying an old reference must not
    // reset the billing period or reactivate an expired subscription.
    if (eventError.code === "23505") {
      return NextResponse.json({ state: subscription.state });
    }
    return NextResponse.json({ error: "Subscription could not be recorded." }, { status: 500 });
  }

  const now = new Date();
  const updatePayload: Record<string, unknown> = {
    state: "active",
    current_period_start: now.toISOString(),
    current_period_end: periodEnd(now, price.interval),
    grace_ends_at: null,
    cancelled_at: null,
    updated_at: now.toISOString(),
  };
  if (verified.authorizationCode) updatePayload.provider_authorization_code = verified.authorizationCode;
  if (verified.customerCode) updatePayload.provider_customer_code = verified.customerCode;
  await admin.from("seller_subscriptions").update(updatePayload).eq("id", subscription.id);

  return NextResponse.json({ state: "active" });
}
