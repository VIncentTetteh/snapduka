"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows, upgradeMessage } from "@/lib/billing/resolve";
import { oneOf, PROMOTION_KINDS } from "@/lib/db/enums";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/growth/promotions";

/**
 * Every refusal here used to be a bare `return`: a seller on Free (or with a
 * typo in the value) pressed Create and the page reloaded with nothing added
 * and no reason. Each one now says what to fix.
 */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function createPromotion(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to create a promotion.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    fail("Your role does not allow creating promotions.");
  }

  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "promotions")) fail(upgradeMessage("promotions"));

  const kind = oneOf(String(formData.get("kind")), PROMOTION_KINDS);
  const value = Number(formData.get("value"));
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!code) fail("Enter a code buyers type at checkout, like LAUNCH20.");
  if (kind !== "fixed" && kind !== "percentage") fail("Choose a percentage or a fixed amount.");
  if (!Number.isInteger(value) || value <= 0) fail("Enter a whole number above zero for the discount.");
  if (kind === "percentage" && value > 100) fail("A percentage discount cannot be more than 100.");

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before adding a promotion.");

  const { error } = await supabase.from("promotions").insert({
    seller_account_id: actor.sellerAccountId,
    shop_id: shop.id,
    name: String(formData.get("name") ?? "").trim() || code,
    code,
    kind,
    value,
    minimum_minor: Number(formData.get("minimumMinor") || 0),
    redemption_limit: Number(formData.get("redemptionLimit") || 0) || null,
  });
  if (error) {
    fail(error.code === "23505" ? `You already have a promotion with the code ${code}.` : "That promotion could not be saved.");
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=created`);
}
