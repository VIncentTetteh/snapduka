import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_TOKEN_SUFFIX, SHARE_CHANNELS } from "@snapduka/core";

import { generateCampaignToken, isUniqueViolation } from "./tokens";

/**
 * Mints the per-channel tracked links for one destination.
 *
 * Three places needed this — Share Studio, the creator portal, and now
 * publishing a shop — and the first two had grown their own copy of the same
 * loop. They agreed today, but the token shape is load-bearing: web and mobile
 * must derive the same token for the same channel or one destination ends up
 * with two competing link sets and its attribution splits between them.
 *
 * Existing channels are skipped rather than duplicated, so calling this twice
 * for a destination is a no-op the second time, and calling it after
 * `SHARE_CHANNELS` grows tops the destination up with only what is missing.
 *
 * The caller passes its own Supabase client, so the write runs under whichever
 * authority that client carries — RLS for a seller or a creator, the service
 * role for publishing, where the seller is still `pending` and cannot write yet.
 */
export type MintLinksInput = {
  sellerAccountId: string;
  shopId: string;
  destinationPath: string;
  label: string;
  campaignId?: string | null;
  creatorPartnershipId?: string | null;
};

export type MintLinksResult =
  | { ok: true; created: number }
  | { ok: false; error: unknown };

export async function mintChannelLinks(
  // Untyped like `checkDestination` beside it, so the same function serves the
  // request-scoped client and the admin one.
  client: SupabaseClient,
  input: MintLinksInput,
): Promise<MintLinksResult> {
  // Scoped to the partnership as well as the destination, because a seller and
  // a creator both mint links for the same product and they are separate sets:
  // matching on the destination alone would let whichever came first make the
  // other a silent no-op, and the creator would be told they already had links
  // when what exists is the seller's.
  const query = client
    .from("campaign_links")
    .select("channel")
    .eq("seller_account_id", input.sellerAccountId)
    .eq("destination_path", input.destinationPath)
    .eq("active", true);

  const { data: existing } = await (input.creatorPartnershipId
    ? query.eq("creator_partnership_id", input.creatorPartnershipId)
    : query.is("creator_partnership_id", null));

  const already = new Set(((existing ?? []) as { channel: string }[]).map((row) => row.channel));
  const wanted = SHARE_CHANNELS.filter((channel) => !already.has(channel));
  if (wanted.length === 0) return { ok: true, created: 0 };

  let lastError: unknown = null;
  // Retry the whole batch on a token collision, and only on a collision —
  // anything else will fail again identically and the caller needs the reason.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const base = generateCampaignToken(6);
    const { error } = await client.from("campaign_links").insert(
      wanted.map((channel) => ({
        seller_account_id: input.sellerAccountId,
        shop_id: input.shopId,
        campaign_id: input.campaignId ?? null,
        creator_partnership_id: input.creatorPartnershipId ?? null,
        name: `${input.label} · ${channel}`,
        token: `${base}-${CHANNEL_TOKEN_SUFFIX[channel]}`,
        channel,
        destination_path: input.destinationPath,
        active: true,
      })),
    );
    if (!error) return { ok: true, created: wanted.length };
    lastError = error;
    if (!isUniqueViolation(error)) break;
  }

  return { ok: false, error: lastError };
}
