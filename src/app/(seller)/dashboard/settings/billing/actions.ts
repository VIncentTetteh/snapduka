"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { effectiveSubscriptionState, type SubscriptionState } from "@/lib/billing/subscriptions";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/dashboard/settings/billing?error=${encodeURIComponent(message)}`);
}

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

export async function changePlan(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role || actor.status !== "active") return;
  const planCode = String(formData.get("planCode") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  if (!["free", "growth", "scale"].includes(planCode)) return;
  if (planCode !== "free" && !["monthly", "yearly"].includes(interval)) return;
  if (!process.env.PAYSTACK_SECRET_KEY) fail("Online billing is not configured yet. Contact support.");

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: existing } = await supabase
    .from("seller_subscriptions")
    .select(
      "id,state,grace_ends_at,current_period_end,provider_subscription_code,provider_email_token,plans!plan_id(code),plan_prices!price_id(interval)",
    )
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  const existingPlan = existing?.plans as { code?: string } | { code?: string }[] | null;
  const existingPlanCode = (Array.isArray(existingPlan) ? existingPlan[0]?.code : existingPlan?.code) ?? "free";
  const existingPriceRow = existing?.plan_prices as { interval?: string } | { interval?: string }[] | null;
  const existingInterval =
    (Array.isArray(existingPriceRow) ? existingPriceRow[0]?.interval : existingPriceRow?.interval) ?? "monthly";
  const existingState = existing
    ? effectiveSubscriptionState({ state: existing.state as SubscriptionState, graceEndsAt: existing.grace_ends_at })
    : "expired";
  const isEntitled = existingState === "active" || existingState === "grace";

  if (isEntitled && existingPlanCode === planCode) fail("You are already on this plan.");
  if (!isEntitled && planCode === "free") fail("Nothing to cancel — you are already on Free.");

  const targetTier = TIER[planCode];
  const currentTier = isEntitled ? TIER[existingPlanCode] : 0;
  const isUpgrade = planCode !== "free" && (!isEntitled || targetTier > currentTier);

  if (!isUpgrade) {
    // Downgrade or cancel: keep current entitlements until current_period_end,
    // disable the old Paystack subscription now so it stops renewing, and
    // record the intended change for the daily cron to apply once the
    // period actually ends.
    if (!isEntitled) fail("Nothing to change.");
    if (existing?.provider_subscription_code && existing.provider_email_token) {
      try {
        await paystackProvider().disableSubscription(existing.provider_subscription_code, existing.provider_email_token);
      } catch {
        fail("Paystack could not update your current subscription. Try again shortly.");
      }
    }
    if (!existing?.current_period_end) {
      // Never left trialing — nothing paid to preserve, cancel immediately.
      await admin
        .from("seller_subscriptions")
        .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", existing!.id);
      revalidatePath("/dashboard/settings/billing");
      revalidatePath("/dashboard", "layout");
      return;
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
      if (!plan) fail("This plan is not available.");
      const { data: price } = await supabase
        .from("plan_prices")
        .select("id")
        .eq("plan_id", plan.id)
        .eq("country", actor.country)
        .eq("interval", existingInterval)
        .eq("active", true)
        .maybeSingle();
      if (!price) fail("This plan is not priced for your billing interval yet.");
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
    revalidatePath("/dashboard/settings/billing");
    revalidatePath("/dashboard", "layout");
    return;
  }

  // Upgrade now (Free→paid, paid→higher tier, or resubscribe after cancelled).
  if (!actor.email) fail("Your account has no billing email.");

  const { data: plan } = await supabase.from("plans").select("id,name,version").eq("code", planCode).eq("active", true).single();
  if (!plan) fail("This plan is not available.");

  const { data: price } = await supabase
    .from("plan_prices")
    .select("id,amount_minor,currency,interval,provider_plan_code")
    .eq("plan_id", plan.id)
    .eq("country", actor.country)
    .eq("interval", interval)
    .eq("active", true)
    .maybeSingle();
  if (!price || price.amount_minor <= 0) fail("This plan is not priced for your country yet.");

  if (existing?.provider_subscription_code && existing.provider_email_token) {
    try {
      await paystackProvider().disableSubscription(existing.provider_subscription_code, existing.provider_email_token);
    } catch {
      fail("Paystack could not update your current subscription. Try again shortly.");
    }
  }

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
      fail("Paystack could not prepare this plan. Try again shortly.");
    }
    await admin.from("plan_prices").update({ provider_plan_code: providerPlanCode }).eq("id", price.id);
  }

  const { error } = await admin.from("seller_subscriptions").upsert(
    {
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
  if (error) fail("Subscription could not be prepared.");

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
    await admin
      .from("seller_subscriptions")
      .delete()
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("state", "trialing");
  }
  if (!authorizationUrl) fail("Paystack could not start billing.");
  redirect(authorizationUrl);
}

export async function cancelSubscription() {
  const formData = new FormData();
  formData.set("planCode", "free");
  await changePlan(formData);
}
