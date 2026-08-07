import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Database } from "@snapduka/core";
import { createAdminClient } from "@/lib/supabase/admin";

type SubscriptionUpdate = Database["public"]["Tables"]["seller_subscriptions"]["Update"];

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
  const rl = await checkRateLimit(`paystack:sub-verify:${actor.sellerAccountId}`, {
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
  const { data: subscription, error: subscriptionError } = await admin
    .from("seller_subscriptions")
    .select(
      "id,state,pending_change_type,pending_plan_id,pending_plan_version,pending_price_id,provider_subscription_code,provider_email_token,plan_prices!price_id(amount_minor,currency,interval),pending_price:plan_prices!pending_price_id(amount_minor,currency,interval)",
    )
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  // A query error is a distinct infrastructure failure from "no subscription
  // exists yet" — surface it as a 500 rather than letting the client read it
  // as "nothing to confirm" and give up silently.
  if (subscriptionError) {
    console.error("[subscription-verify] seller_subscriptions query failed", subscriptionError);
    return NextResponse.json({ error: "Subscription lookup failed." }, { status: 500 });
  }
  if (!subscription) return NextResponse.json({ error: "No pending subscription." }, { status: 404 });

  const isPendingUpgrade = subscription.pending_change_type === "upgrade";
  // An entitled seller upgrading is already 'active' on their OLD plan, so the
  // usual "already active, nothing to do" shortcut would swallow the very
  // payment that promotes them.
  if (subscription.state === "active" && !isPendingUpgrade) {
    return NextResponse.json({ state: "active" });
  }

  type PriceRow = { amount_minor: number; currency: string; interval: string };
  const one = (value: unknown): PriceRow | null => {
    const row = value as PriceRow | PriceRow[] | null;
    return Array.isArray(row) ? (row[0] ?? null) : row;
  };
  // Verify against what they are actually being charged: the pending price for
  // an upgrade, the current one otherwise.
  const price = isPendingUpgrade
    ? one(subscription.pending_price)
    : one(subscription.plan_prices);
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
  const updatePayload: SubscriptionUpdate = {
    state: "active",
    current_period_start: now.toISOString(),
    current_period_end: periodEnd(now, price.interval),
    grace_ends_at: null,
    cancelled_at: null,
    updated_at: now.toISOString(),
  };
  if (verified.authorizationCode) updatePayload.provider_authorization_code = verified.authorizationCode;
  if (verified.customerCode) updatePayload.provider_customer_code = verified.customerCode;

  if (isPendingUpgrade) {
    // Payment cleared, so promote the parked target and clear the pending
    // fields. Only now is the seller genuinely off their old plan.
    updatePayload.plan_id = subscription.pending_plan_id ?? undefined;
    updatePayload.plan_version = subscription.pending_plan_version ?? undefined;
    updatePayload.price_id = subscription.pending_price_id ?? undefined;
    updatePayload.pending_change_type = null;
    updatePayload.pending_plan_id = null;
    updatePayload.pending_plan_version = null;
    updatePayload.pending_price_id = null;
  }

  await admin.from("seller_subscriptions").update(updatePayload).eq("id", subscription.id);

  // Retire the superseded Paystack subscription only after the replacement is
  // paid for, so an abandoned checkout never cancels a renewal the seller
  // still wants. Best-effort: the plan change is already committed above, and
  // a stale provider subscription is recoverable where a lost plan is not.
  if (isPendingUpgrade && subscription.provider_subscription_code && subscription.provider_email_token) {
    try {
      await paystackProvider().disableSubscription(
        subscription.provider_subscription_code,
        subscription.provider_email_token,
      );
    } catch (error) {
      console.error(
        "[subscription-verify] could not disable the superseded subscription",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  return NextResponse.json({ state: "active" });
}
