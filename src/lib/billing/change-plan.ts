import { randomUUID } from "node:crypto";

import { appOrigin } from "@/lib/app-url";
import type { SellerActor } from "@/lib/auth/actor";
import { effectiveSubscriptionState, type SubscriptionState } from "@/lib/billing/subscriptions";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Changing a seller's plan.
 *
 * This lived inside the billing server action, which meant it could only ever
 * end in a redirect — so the mobile app had no way to reach it and shipped an
 * "Upgrade" button that opened the web dashboard in a browser. Mobile keeps its
 * session in SecureStore and never as a browser cookie, so the seller arrived
 * with no session and hit a login wall: the paid conversion path was a dead end
 * on the app.
 *
 * It returns an outcome instead. The web action turns that back into a
 * redirect; the mobile route hands the Paystack URL to the app, which opens it
 * directly — Paystack's checkout page needs no SnapDuka session, so the login
 * wall disappears entirely.
 *
 * The logic below is unchanged: same tier and interval rules, same
 * pending_* parking of an entitled seller's upgrade, same rollback when
 * Paystack fails.
 */

export type PlanChangeInput = {
  planCode: string;
  /** Omitted means "keep my current cadence" for an existing subscription. */
  interval?: string | null;
};

export type PlanChangeOutcome =
  /** Send the seller to Paystack to authorise the charge. */
  | { ok: true; kind: "checkout"; authorizationUrl: string }
  /** Applied or parked for the cron; nothing to pay right now. */
  | { ok: true; kind: "scheduled"; message: string }
  | { ok: false; message: string };

function refuse(message: string): PlanChangeOutcome {
  return { ok: false, message };
}

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };
// Yearly is the bigger commitment, so moving to it is charged now like any
// other upgrade, and moving off it waits for the paid year to finish.
const INTERVAL_RANK: Record<string, number> = { monthly: 0, yearly: 1 };

export async function planChange(
  actor: SellerActor,
  input: PlanChangeInput,
): Promise<PlanChangeOutcome> {
  // Paying us is not the same as being paid by us: a seller is `pending` from
  // signup until verification completes, and taking a subscription payment from
  // them is exactly what should happen. Only accounts genuinely switched off are
  // refused. This lives here rather than in the web action's guard so the mobile
  // route cannot forget it.
  if (actor.status === "suspended") {
    return refuse("This account is suspended, so its plan cannot be changed. Contact support.");
  }
  if (actor.status === "closed") {
    return refuse("This account is closed, so its plan cannot be changed.");
  }

  const planCode = String(input.planCode ?? "");
  const intervalEntry = input.interval ?? null;
  const requestedInterval =
    typeof intervalEntry === "string" && ["monthly", "yearly"].includes(intervalEntry)
      ? intervalEntry
      : null;
  if (!["free", "growth", "scale"].includes(planCode)) return refuse("That plan does not exist.");
  if (planCode !== "free" && intervalEntry !== null && !requestedInterval) {
    return refuse("Choose either monthly or yearly billing.");
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return refuse("Online billing is not configured yet. Contact support.");

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("seller_subscriptions")
    .select(
      "id,state,grace_ends_at,current_period_end,provider_subscription_code,provider_email_token,plans!plan_id(code),plan_prices!price_id(interval)",
    )
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  // A query error here is an infrastructure failure, not "no subscription" —
  // fail loudly rather than silently treating the seller as Free/no-sub,
  // which could let a plan change apply on top of stale/wrong state.
  if (existingError) {
    console.error("[changePlan] seller_subscriptions query failed", existingError);
    return refuse("Could not load your subscription. Try again shortly.");
  }

  const existingPlan = existing?.plans as { code?: string } | { code?: string }[] | null;
  const existingPlanCode = (Array.isArray(existingPlan) ? existingPlan[0]?.code : existingPlan?.code) ?? "free";
  const existingPriceRow = existing?.plan_prices as { interval?: string } | { interval?: string }[] | null;
  const existingInterval =
    (Array.isArray(existingPriceRow) ? existingPriceRow[0]?.interval : existingPriceRow?.interval) ?? "monthly";
  // Missing interval means "keep my current cadence" for an existing paid
  // subscription, while new subscriptions sensibly default to monthly.
  const interval = requestedInterval ?? (existing ? existingInterval : "monthly");
  const existingState = existing
    ? effectiveSubscriptionState({ state: existing.state as SubscriptionState, graceEndsAt: existing.grace_ends_at })
    : "expired";
  const isEntitled = existingState === "active" || existingState === "grace";

  // Same plan AND same interval is genuinely a no-op; same plan on a different
  // interval is a real change the seller could not previously make at all.
  const isIntervalChange =
    isEntitled && planCode !== "free" && existingPlanCode === planCode && interval !== existingInterval;
  if (isEntitled && existingPlanCode === planCode && !isIntervalChange) {
    return refuse("You are already on this plan.");
  }
  if (!isEntitled && planCode === "free") return refuse("Nothing to cancel — you are already on Free.");

  const targetTier = TIER[planCode];
  const currentTier = isEntitled ? TIER[existingPlanCode] : 0;
  const isUpgrade =
    planCode !== "free" &&
    (!isEntitled ||
      targetTier > currentTier ||
      // Monthly -> yearly on the same plan: charge now, like any upgrade.
      (targetTier === currentTier &&
        (INTERVAL_RANK[interval] ?? 0) > (INTERVAL_RANK[existingInterval] ?? 0)));

  // Respect an explicitly selected cadence on a tier downgrade. Legacy callers
  // that omit it still preserve the seller's existing billing interval.
  const scheduledInterval = requestedInterval ?? existingInterval;

  if (!isUpgrade) {
    // Downgrade or cancel: keep current entitlements until current_period_end,
    // disable the old Paystack subscription now so it stops renewing, and
    // record the intended change for the daily cron to apply once the
    // period actually ends.
    if (!isEntitled) return refuse("Nothing to change.");
    if (existing?.provider_subscription_code && existing.provider_email_token) {
      try {
        await paystackProvider().disableSubscription(existing.provider_subscription_code, existing.provider_email_token);
      } catch {
        return refuse("Paystack could not update your current subscription. Try again shortly.");
      }
    }
    if (!existing?.current_period_end) {
      // Never left trialing — nothing paid to preserve, cancel immediately.
      await admin
        .from("seller_subscriptions")
        .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", existing!.id);
      return { ok: true, kind: "scheduled", message: "Your subscription has been cancelled." };
    }
    if (planCode === "free") {
      await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: "cancel",
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", existing.id);
    } else {
      const { data: plan } = await supabase.from("plans").select("id,version").eq("code", planCode).eq("active", true).single();
      if (!plan) return refuse("This plan is not available.");
      const { data: price } = await supabase
        .from("plan_prices")
        .select("id")
        .eq("plan_id", plan.id)
        .eq("country", actor.country)
        .eq("interval", scheduledInterval)
        .eq("active", true)
        .maybeSingle();
      if (!price) return refuse("This plan is not priced for your billing interval yet.");
      await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: "downgrade",
          pending_plan_id: plan.id,
          pending_plan_version: plan.version,
          pending_price_id: price.id,
        })
        .eq("id", existing.id);
    }
    return {
      ok: true,
      kind: "scheduled",
      message:
        planCode === "free"
          ? "Your plan will move to Free at the end of the current period."
          : "Your plan change will take effect at the end of the current period.",
    };
  }

  // Upgrade now (Free→paid, paid→higher tier, or resubscribe after cancelled).
  if (!actor.email) return refuse("Your account has no billing email.");

  const { data: plan } = await supabase.from("plans").select("id,name,version").eq("code", planCode).eq("active", true).single();
  if (!plan) return refuse("This plan is not available.");

  const { data: price } = await supabase
    .from("plan_prices")
    .select("id,amount_minor,currency,interval,provider_plan_code")
    .eq("plan_id", plan.id)
    .eq("country", actor.country)
    .eq("interval", interval)
    .eq("active", true)
    .maybeSingle();
  if (!price || price.amount_minor <= 0) return refuse("This plan is not priced for your country yet.");

  // The old Paystack subscription is deliberately NOT disabled here. Until the
  // new charge succeeds the seller is still on — and still paying for — their
  // current plan, so cancelling their renewal now would strand them if they
  // abandon the checkout.

  let providerPlanCode = price.provider_plan_code;
  if (!providerPlanCode) {
    try {
      const created = await paystackProvider().createPlan({
        name: `SnapDuka ${plan.name} (${price.currency} ${interval})`,
        interval: interval === "yearly" ? "annually" : "monthly",
        amountMinor: price.amount_minor,
        currency: price.currency,
      });
      providerPlanCode = created.planCode;
    } catch {
      return refuse("Paystack could not prepare this plan. Try again shortly.");
    }
    await admin.from("plan_prices").update({ provider_plan_code: providerPlanCode }).eq("id", price.id);
  }

  // An entitled seller keeps everything they are paying for until the new
  // charge clears; the target is parked in the pending_* columns and promoted
  // by subscription-verify (or the webhook). Overwriting the live row with a
  // 'trialing' one — which grants nothing — used to downgrade a paying seller
  // to Free the moment they clicked Upgrade.
  const { error } = isEntitled
    ? await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: "upgrade",
          pending_plan_id: plan.id,
          pending_plan_version: plan.version,
          pending_price_id: price.id,
        })
        .eq("id", existing!.id)
    : await admin.from("seller_subscriptions").upsert(
        {
          // Nothing to preserve: no subscription, or one already expired or
          // cancelled. 'trialing' is the pending-checkout placeholder.
          seller_account_id: actor.sellerAccountId,
          plan_id: plan.id,
          plan_version: plan.version,
          price_id: price.id,
          state: "trialing",
          current_period_start: new Date().toISOString(),
          current_period_end: null,
          grace_ends_at: null,
          cancelled_at: null,
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        },
        { onConflict: "seller_account_id" },
      );
  if (error) return refuse("Subscription could not be prepared.");

  let authorizationUrl: string | null = null;
  try {
    const payment = await paystackProvider().initializeSubscription({
      email: actor.email,
      amountMinor: price.amount_minor,
      currency: price.currency,
      reference: `subscription-${actor.sellerAccountId}-${randomUUID()}`,
      planCode: providerPlanCode,
      callbackUrl: `${await appOrigin()}/dashboard/settings/billing?payment=pending`,
      metadata: { purpose: "subscription", sellerAccountId: actor.sellerAccountId, priceId: price.id },
    });
    authorizationUrl = payment.authorizationUrl;
  } catch {
    // Roll back whichever shape we wrote above, so a Paystack outage does not
    // leave a phantom pending upgrade or a dangling trialing row.
    if (isEntitled) {
      await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", existing!.id)
        .eq("pending_change_type", "upgrade");
    } else {
      await admin
        .from("seller_subscriptions")
        .delete()
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("state", "trialing");
    }
  }
  if (!authorizationUrl) return refuse("Paystack could not start billing.");
  return { ok: true, kind: "checkout", authorizationUrl };
}
