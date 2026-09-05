"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { generateCampaignToken, isUniqueViolation } from "@/lib/campaigns/tokens";
import { checkDestination, DESTINATION_REFUSED } from "@/lib/campaigns/destination";
import { CHANNEL_TOKEN_SUFFIX, SHARE_CHANNELS } from "@snapduka/core";
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

  // Retry the whole batch on a token collision. Both exits from this loop used
  // to be silent — including the one taken when the insert failed for a reason
  // that is not a collision — so the seller was left with no links and nothing
  // saying why, which is the state the comment above claimed to have fixed.
  let inserted = rows.length === 0;
  let lastError: unknown = null;
  for (let attempt = 0; rows.length > 0 && attempt < 5; attempt++) {
    const prefix = attempt === 0 ? base : shortCode();
    const { error } = await supabase
      .from("campaign_links")
      .insert(rows.map((row) => ({ ...row, token: `${prefix}-${row.token.split("-").pop()}` })));
    if (!error) {
      inserted = true;
      break;
    }
    lastError = error;
    if (!isUniqueViolation(error)) break;
  }

  if (!inserted) {
    console.error("[generateShareLinksAction] could not mint links", { error: lastError });
    fail("Those share links could not be created. Please try again.");
  }

  revalidatePath(SHARE_PATH);
  redirect(`${SHARE_PATH}?saved=links`);
}
