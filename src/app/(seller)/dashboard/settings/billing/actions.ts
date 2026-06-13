"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

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
        .select("id")
        .eq("plan_id", plan.id)
        .eq("country", actor.country)
        .eq("interval", interval)
        .eq("active", true)
        .maybeSingle()
    : { data: null };
  if (!plan) return;

  await supabase.from("seller_subscriptions").upsert(
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
  revalidatePath("/dashboard/settings/billing");
}

export async function cancelSubscription() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const supabase = await createClient();
  await supabase
    .from("seller_subscriptions")
    .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/billing");
}
