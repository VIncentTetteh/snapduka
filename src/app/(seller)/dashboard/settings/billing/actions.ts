"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { paystackProvider } from "@/lib/payments/paystack";

export async function selectPlan(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role || actor.status !== "active") return;
  const planCode = String(formData.get("planCode") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  if (!["growth", "scale"].includes(planCode) || !["monthly", "yearly"].includes(interval)) return;

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("plans")
    .select("id,version")
    .eq("code", planCode)
    .eq("active", true)
    .single();
  const { data: price } = plan
    ? await supabase
        .from("plan_prices")
        .select("id,amount_minor,currency,provider_plan_code")
        .eq("plan_id", plan.id)
        .eq("country", actor.country)
        .eq("interval", interval)
        .eq("active", true)
        .maybeSingle()
    : { data: null };
  if (!plan || !price?.provider_plan_code || price.amount_minor <= 0) {
    redirect("/dashboard/settings/billing?error=This+plan+is+not+configured+for+your+country");
  }

  const { error } = await supabase.from("seller_subscriptions").upsert(
    {
      seller_account_id: actor.sellerAccountId,
      plan_id: plan.id,
      plan_version: plan.version,
      price_id: price?.id ?? null,
      state: "trialing",
      current_period_start: new Date().toISOString(),
    },
    { onConflict: "seller_account_id" },
  );
  if (error) redirect("/dashboard/settings/billing?error=Subscription+could+not+be+prepared");
  let authorizationUrl: string;
  try {
    const payment = await paystackProvider().initializeSubscription({
      email: actor.email ?? "",
      amountMinor: price.amount_minor,
      currency: price.currency,
      reference: `subscription-${actor.sellerAccountId}-${randomUUID()}`,
      planCode: price.provider_plan_code,
      callbackUrl: `${await appOrigin()}/dashboard/settings/billing?payment=pending`,
      metadata: { purpose: "subscription", sellerAccountId: actor.sellerAccountId, priceId: price.id },
    });
    authorizationUrl = payment.authorizationUrl;
  } catch {
    await supabase.from("seller_subscriptions").delete().eq("seller_account_id", actor.sellerAccountId).eq("state", "trialing");
    redirect("/dashboard/settings/billing?error=Paystack+could+not+start+billing");
  }
  redirect(authorizationUrl);
}

export async function cancelSubscription() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const supabase = await createClient();
  const { data: subscription } = await supabase.from("seller_subscriptions").select("provider_subscription_code,provider_email_token").eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (subscription?.provider_subscription_code && subscription.provider_email_token) {
    try {
      await paystackProvider().disableSubscription(subscription.provider_subscription_code, subscription.provider_email_token);
    } catch {
      redirect("/dashboard/settings/billing?error=Paystack+could+not+cancel+the+subscription");
    }
  }
  await supabase
    .from("seller_subscriptions")
    .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/billing");
}
