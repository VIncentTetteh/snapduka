"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows, upgradeMessage } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/settings/discovery";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Opting the shop into buyer discovery.
 *
 * Every branch here used to `return` with nothing said, and one of them sits on
 * the happy path: discovery is a paid feature, so a seller on Free who ticked
 * the box and pressed Save got no charge prompt, no upgrade notice and no
 * error — just the same page with the box unticked again. There is no way to
 * tell that apart from a bug, and nothing on the page explains it.
 */
export async function saveDiscovery(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to change discovery settings.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }

  const optedIn = formData.get("optedIn") === "on";
  if (optedIn) {
    const plan = await getSellerPlan(actor.sellerAccountId);
    if (!planAllows(plan, "discovery")) fail(upgradeMessage("Buyer discovery"));
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!shop) fail("Create your shop before listing it in discovery.");

  const { error } = await supabase.from("discovery_preferences").upsert({
    shop_id: shop.id,
    seller_account_id: actor.sellerAccountId,
    opted_in: optedIn,
    category: String(formData.get("category") ?? "").trim() || null,
    city: String(formData.get("city") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
  });
  // The upsert error was discarded, so a failed save looked identical to a
  // successful one.
  if (error) fail("Those discovery settings could not be saved.");

  await supabase.rpc("refresh_discovery_listing", { p_shop_id: shop.id });
  revalidatePath(PATH);
  revalidatePath("/discover");
  redirect(`${PATH}?saved=1`);
}
