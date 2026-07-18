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

export async function selectPlan(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role || actor.status !== "active") return;
  const planCode = String(formData.get("planCode") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  if (!["growth", "scale"].includes(planCode) || !["monthly", "yearly"].includes(interval)) return;
  if (!process.env.PAYSTACK_SECRET_KEY) fail("Online billing is not configured yet. Contact support.");
  if (!actor.email) fail("Your account has no billing email.");

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("plans")
    .select("id,name,version")
    .eq("code", planCode)
    .eq("active", true)
    .single();
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

  // One subscription per seller: an active/grace plan must be cancelled before
  // switching so a failed checkout can never clobber a paid plan.
  const { data: existing } = await supabase
    .from("seller_subscriptions")
    .select("state,grace_ends_at,plan_id")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (existing) {
    const state = effectiveSubscriptionState({
      state: existing.state as SubscriptionState,
      graceEndsAt: existing.grace_ends_at,
    });
    if (state === "active" || state === "grace") {
      fail(
        existing.plan_id === plan.id
          ? "You are already on this plan."
          : "Cancel your current plan before switching to a different one.",
      );
    }
  }

  // Paystack recurring billing needs a provider plan. Create it lazily on
  // first purchase of this price and persist the code for every later seller.
  const admin = createAdminClient();
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

  const { error } = await supabase.from("seller_subscriptions").upsert(
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
    await supabase
      .from("seller_subscriptions")
      .delete()
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("state", "trialing");
  }
  if (!authorizationUrl) fail("Paystack could not start billing.");
  redirect(authorizationUrl);
}

export async function cancelSubscription() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const supabase = await createClient();
  const { data: subscription } = await supabase
    .from("seller_subscriptions")
    .select("provider_subscription_code,provider_email_token")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (subscription?.provider_subscription_code && subscription.provider_email_token) {
    try {
      await paystackProvider().disableSubscription(
        subscription.provider_subscription_code,
        subscription.provider_email_token,
      );
    } catch {
      fail("Paystack could not cancel the subscription.");
    }
  }
  await supabase
    .from("seller_subscriptions")
    .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/billing");
  revalidatePath("/dashboard", "layout");
}
