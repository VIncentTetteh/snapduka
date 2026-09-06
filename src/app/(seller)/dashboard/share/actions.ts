"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { checkDestination, DESTINATION_REFUSED } from "@/lib/campaigns/destination";
import { mintChannelLinks } from "@/lib/campaigns/mint";
import { createClient } from "@/lib/supabase/server";

const SHARE_PATH = "/dashboard/share";

function fail(message: string): never {
  redirect(`${SHARE_PATH}?error=${encodeURIComponent(message)}`);
}

const NOT_ALLOWED = "Your role does not allow managing sharing.";

export async function disconnectSocialAccountAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to disconnect an account.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) fail(NOT_ALLOWED);

  const provider = String(formData.get("provider") ?? "");
  if (!provider) fail("That account could not be identified.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("provider", provider);
  if (error) fail("That account could not be disconnected.");

  revalidatePath(SHARE_PATH);
  redirect(`${SHARE_PATH}?saved=disconnected`);
}

/** Creates the per-channel tracked short links for a destination if missing. */
export async function generateShareLinksAction(formData: FormData): Promise<void> {
  const destinationPath = String(formData.get("destinationPath") ?? "/");
  const label = String(formData.get("label") ?? "Storefront").slice(0, 80);
  // Optional: links minted while publishing can land inside a campaign instead
  // of floating loose.
  const campaignId = String(formData.get("campaignId") ?? "").trim() || null;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to create share links.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) fail(NOT_ALLOWED);

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!shop) fail("Create your shop before making share links.");

  // destination_path used to be inserted exactly as posted, so a link could be
  // minted pointing at any path on the site — including another seller's shop
  // or product, which is how four dead links ended up in production.
  const destination = await checkDestination(
    supabase,
    actor.sellerAccountId,
    shop,
    destinationPath,
  );
  if (!destination.ok) fail(DESTINATION_REFUSED);

  // campaign_id is written straight into campaign_links — no policy on
  // `campaigns` is ever consulted, because the campaign is never read. (A
  // comment here used to claim RLS covered this; it did not, and a wrong comment
  // about a security property is worse than no comment.) The composite FK now
  // refuses a foreign id, but that surfaces as an insert error the loop below
  // swallows, so the seller would get no links and no reason.
  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle();
    if (!campaign) fail("That campaign could not be found.");
  }

  // Skipping existing channels, retrying only on a token collision, and the
  // token shape itself all live in mintChannelLinks now — publishing a shop
  // needs exactly the same thing, and three copies of it would eventually
  // disagree about a token, which splits a destination's attribution in two.
  const minted = await mintChannelLinks(supabase, {
    sellerAccountId: actor.sellerAccountId,
    shopId: shop.id,
    destinationPath: destination.path,
    label,
    campaignId,
  });

  if (!minted.ok) {
    console.error("[generateShareLinksAction] could not mint links", { error: minted.error });
    fail("Those share links could not be created. Please try again.");
  }

  revalidatePath(SHARE_PATH);
  redirect(`${SHARE_PATH}?saved=links`);
}
