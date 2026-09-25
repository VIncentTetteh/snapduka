"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planLimit, withinPlanLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/growth/segments";

/** Refusals used to return silently, including the plan limit; now they say why. */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function createSegment(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to create a segment.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    fail("Your role does not allow creating customer segments.");
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) fail("Give the segment a name, like Repeat buyers.");

  const supabase = await createClient();
  const [plan, { count }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase
      .from("customer_segments")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId),
  ]);
  if (!withinPlanLimit(plan, "customerSegments", count ?? 0)) {
    fail(
      `Your ${plan.planName} plan includes ${planLimit(plan, "customerSegments")} segments. Upgrade in Settings → Plan & billing to add more.`,
    );
  }

  const rules = {
    minimumOrders: Number(formData.get("minimumOrders") || 0),
    minimumSpendMinor: Number(formData.get("minimumSpendMinor") || 0),
    orderedWithinDays: Number(formData.get("orderedWithinDays") || 0) || undefined,
  };
  const { error } = await supabase
    .from("customer_segments")
    .insert({ seller_account_id: actor.sellerAccountId, name, rules });
  if (error) fail("That segment could not be saved.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=created`);
}
