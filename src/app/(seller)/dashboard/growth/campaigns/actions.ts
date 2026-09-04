"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAMPAIGN_CHANNELS, storefrontPath } from "@snapduka/core";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { normalizeCampaignToken } from "@/lib/campaigns/links";
import { withUniqueToken } from "@/lib/campaigns/tokens";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a tracked link.
 *
 * Every branch of this used to `return` silently, so a seller who could not
 * create a link — wrong role, no shop, a name that produced an invalid token —
 * saw the form reload unchanged and nothing else. That is the same defect that
 * made billing unpayable (ISSUE-011) and payout review unrefusable, and on a
 * page whose only job is creating one thing it is the whole page.
 */
function fail(message: string): never {
  redirect(`/dashboard/growth/campaigns?error=${encodeURIComponent(message)}`);
}

/**
 * `campaign_links_token_shape_check` is `^[a-z0-9][a-z0-9-]{3,63}$`: 4–64
 * characters, starting alphanumeric. The old code appended a 6-character
 * random suffix to the whole normalized name, which broke the constraint two
 * ways — a name of only punctuation ("🎉") normalizes to "", giving a token
 * that starts with "-", and a long name pushed the total past 64. Both failed
 * silently.
 */
const MAX_SLUG = 55;

function tokenFor(name: string, random: string): string {
  const slug = normalizeCampaignToken(name).slice(0, MAX_SLUG).replace(/-+$/, "");
  return slug ? `${slug}-${random}` : random;
}

export async function createCampaign(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to create a link.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) {
    fail("Your role does not allow creating campaign links.");
  }

  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "campaigns")) {
    fail(`Tracked links are not included in the ${plan.planName} plan.`);
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) fail("Give the link a name so you can tell it apart later.");

  // The allow-list lives in core precisely so it cannot drift from the CHECK
  // constraint; this used to inline its own copy.
  const channelInput = String(formData.get("channel") ?? "");
  const channel = CAMPAIGN_CHANNELS.find((candidate) => candidate === channelInput);
  if (!channel) fail("Choose a channel to post this link on.");

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before making a tracked link.");

  try {
    await withUniqueToken(async (random) =>
      supabase
        .from("campaign_links")
        .insert({
          seller_account_id: actor.sellerAccountId,
          shop_id: shop.id,
          name,
          token: tokenFor(name, random),
          channel,
          // Never set before, so every link this action made fell back to the
          // column default '/', which via /l/{token} is the app root rather
          // than the seller's shop.
          destination_path: storefrontPath(shop.slug),
          active: true,
        })
        .select("id")
        .single(),
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "That link could not be created.");
  }

  revalidatePath("/dashboard/growth/campaigns");
}
