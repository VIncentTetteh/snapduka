"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { generateCampaignToken, isUniqueViolation } from "@/lib/campaigns/tokens";
import { checkDestination, DESTINATION_REFUSED } from "@/lib/campaigns/destination";
import { CHANNEL_TOKEN_SUFFIX, SHARE_CHANNELS } from "@snapduka/core";
import { createClient } from "@/lib/supabase/server";

export async function disconnectSocialAccountAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;
  const provider = String(formData.get("provider") ?? "");
  if (!provider) return;
  const supabase = await createClient();
  await supabase
    .from("social_accounts")
    .delete()
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("provider", provider);
  revalidatePath("/dashboard/share");
}

// From @snapduka/core so the app and the web mint the same token for the same
// channel. Two clients disagreeing here would create competing links for one
// destination and split its attribution between them.
const CHANNELS = SHARE_CHANNELS;
const CHANNEL_SUFFIX = CHANNEL_TOKEN_SUFFIX;

// Was Math.random().toString(36).slice(2, 6): a ~1.7M keyspace on a globally
// unique column, enumerable by anyone who wanted another seller's links.
function shortCode(): string {
  return generateCampaignToken(6);
}

/** Creates the per-channel tracked short links for a destination if missing. */
export async function generateShareLinksAction(formData: FormData): Promise<void> {
  const destinationPath = String(formData.get("destinationPath") ?? "/");
  const label = String(formData.get("label") ?? "Storefront").slice(0, 80);
  // Optional: links minted while publishing can land inside a campaign instead
  // of floating loose.
  const campaignId = String(formData.get("campaignId") ?? "").trim() || null;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!shop) return;

  // destination_path used to be inserted exactly as posted, so a link could be
  // minted pointing at any path on the site — including another seller's shop
  // or product, which is how four dead links ended up in production.
  const destination = await checkDestination(
    supabase,
    actor.sellerAccountId,
    shop,
    destinationPath,
  );
  if (!destination.ok) {
    redirect(`/dashboard/share?error=${encodeURIComponent(DESTINATION_REFUSED)}`);
  }

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
    if (!campaign) {
      redirect(
        `/dashboard/share?error=${encodeURIComponent("That campaign could not be found.")}`,
      );
    }
  }

  const { data: existing } = await supabase
    .from("campaign_links")
    .select("channel")
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("destination_path", destination.path)
    .eq("active", true);

  const existingChannels = new Set((existing ?? []).map((link) => link.channel));
  const base = shortCode();
  const rows = CHANNELS.filter((channel) => !existingChannels.has(channel)).map((channel) => ({
    seller_account_id: actor.sellerAccountId,
    shop_id: shop.id,
    name: `${label} · ${channel}`,
    token: `${base}-${CHANNEL_SUFFIX[channel]}`,
    channel,
    destination_path: destination.path,
    active: true,
    campaign_id: campaignId,
  }));

  // Retry the whole batch on a token collision rather than swallowing the
  // error, which used to look to the seller like links that never appeared.
  for (let attempt = 0; rows.length > 0 && attempt < 5; attempt++) {
    const prefix = attempt === 0 ? base : shortCode();
    const { error } = await supabase
      .from("campaign_links")
      .insert(rows.map((row) => ({ ...row, token: `${prefix}-${row.token.split("-").pop()}` })));
    if (!error) break;
    if (!isUniqueViolation(error)) break;
  }

  revalidatePath("/dashboard/share");
}
