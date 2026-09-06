"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveCreatorContext } from "@/lib/auth/actor";
import { checkDestination, DESTINATION_REFUSED } from "@/lib/campaigns/destination";
import { mintChannelLinks } from "@/lib/campaigns/mint";
import { createClient } from "@/lib/supabase/server";

const PATH = "/creator/links";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * A creator mints their own tracked links.
 *
 * Until now the only path that could create one was `createCreatorLink` in the
 * seller's dashboard: seller-only, and hardcoded to the shop homepage. So an
 * influencer's ability to earn was blocked on a shop owner remembering to press
 * a button and send them a URL, and even then the link could not point at the
 * product they were actually posting about. Production has never completed a
 * cycle: two invitations, none accepted, one of seventeen links attached to a
 * creator.
 *
 * Deliberately the same shape as `generateShareLinksAction` in the seller's
 * Share Studio — one short base token, one row per channel with a one-character
 * suffix — so a creator's links behave identically to a seller's everywhere
 * downstream: `/l/<token>`, `campaign_link_totals`, attribution, accrual.
 *
 * Authority is the database's, not this function's. `campaign_links_creator_insert`
 * (202609060096) requires an active partnership of this creator's for that
 * seller; `campaign_links_guard_destination` refuses any path outside the shop;
 * and `campaign_links_shop_same_seller` makes the tenant columns agree. This
 * only turns those refusals into something a person can read.
 */
export async function createCreatorLinks(formData: FormData): Promise<void> {
  const creator = await resolveCreatorContext();
  if (!creator) redirect("/creator/start");

  const partnershipId = String(formData.get("partnershipId") ?? "");
  const destinationPath = String(formData.get("destinationPath") ?? "");
  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  if (!partnershipId) fail("Choose which shop this link is for.");
  if (!destinationPath) fail("Choose what to link to.");

  const supabase = await createClient();

  // RLS already scopes creator_partnerships to this creator, so a partnership id
  // that is not theirs simply returns nothing.
  const { data: partnership } = await supabase
    .from("creator_partnerships")
    .select("id,status,seller_account_id")
    .eq("id", partnershipId)
    .maybeSingle();
  if (!partnership) fail("That shop is no longer connected to you.");
  if (partnership.status !== "active") {
    fail("That partnership is paused, so new links cannot be created for it.");
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug,display_name")
    .eq("seller_account_id", partnership.seller_account_id)
    .maybeSingle();
  if (!shop) fail("That shop is not available right now.");

  // Same validation the seller gets, pointed at the partnered seller rather
  // than the caller: the storefront root or one of that shop's own products.
  const destination = await checkDestination(
    supabase,
    partnership.seller_account_id,
    shop,
    destinationPath,
  );
  if (!destination.ok) fail(DESTINATION_REFUSED);

  // One link per channel, sharing a base token, so the creator can tell which
  // platform an order came from. The same helper the seller's Share Studio uses,
  // so a creator's links are indistinguishable from a seller's everywhere
  // downstream: /l/<token>, campaign_link_totals, attribution, accrual. Existing
  // channels are skipped, so pressing the button twice is a no-op.
  const minted = await mintChannelLinks(supabase, {
    sellerAccountId: partnership.seller_account_id,
    shopId: shop.id,
    destinationPath: destination.path,
    label: label || shop.display_name,
    creatorPartnershipId: partnershipId,
  });

  if (!minted.ok) {
    console.error("[creator-links] could not mint links", { partnershipId, error: minted.error });
    fail("Those links could not be created. Please try again.");
  }
  if (minted.created === 0) {
    redirect(`${PATH}?saved=exists&for=${encodeURIComponent(destination.path)}`);
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=created&for=${encodeURIComponent(destination.path)}`);
}
