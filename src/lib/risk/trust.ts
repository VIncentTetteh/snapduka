import "server-only";

import { cache } from "react";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading the nightly seller trust score (compute_seller_trust_scores,
 * 202609250144). Weights and tier rules are documented in that migration.
 *
 * Two audiences, deliberately separate:
 *   * money code (Protect limits, instant payouts) calls getTrustTier and gets
 *     the full answer, including `watch`, with no flag check — a risk gate
 *     must not silently open because a display flag is off;
 *   * the storefront calls getStorefrontTrustTier, which answers only the
 *     tiers a buyer may see, and only while `trust_score` is on for the seller.
 */

export const TRUST_TIERS = ["new", "bronze", "silver", "gold", "watch"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];
export type PublicTrustTier = Extract<TrustTier, "bronze" | "silver" | "gold">;

export type TrustScore = {
  tier: TrustTier;
  score: number;
  computedAt: string;
  weightsVersion: string;
};

function isTrustTier(value: unknown): value is TrustTier {
  return typeof value === "string" && (TRUST_TIERS as readonly string[]).includes(value);
}

export function isPublicTrustTier(tier: TrustTier | null | undefined): tier is PublicTrustTier {
  return tier === "bronze" || tier === "silver" || tier === "gold";
}

/**
 * The seller's latest trust score, or null if it has never been computed
 * (a seller created since last night's run). Callers gating money must treat
 * null as the most cautious tier, `new` — never as "no limit".
 */
export async function getTrustTier(sellerAccountId: string): Promise<TrustScore | null> {
  const { data, error } = await createAdminClient()
    .from("seller_trust_scores")
    .select("tier,score,computed_at,weights_version")
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();
  if (error) {
    console.error("[trust] could not read the trust score", error.message);
    return null;
  }
  if (!data || !isTrustTier(data.tier)) return null;
  return {
    tier: data.tier,
    score: data.score,
    computedAt: data.computed_at,
    weightsVersion: data.weights_version,
  };
}

/**
 * The tier to show on a storefront, or null to show nothing. Looked up by
 * slug so the header can render it without every page threading a seller id
 * through; `cache` makes the header's repeated renders on one request free.
 * Any failure shows nothing — a missing badge is harmless, a wrong one is not.
 */
export const getStorefrontTrustTier = cache(async (slug: string): Promise<PublicTrustTier | null> => {
  try {
    return await lookupStorefrontTier(slug);
  } catch (error) {
    // Includes a missing service key at build time: the header must render.
    console.error("[trust] storefront tier lookup failed", error instanceof Error ? error.message : error);
    return null;
  }
});

async function lookupStorefrontTier(slug: string): Promise<PublicTrustTier | null> {
  const admin = createAdminClient();
  const { data: shop } = await admin
    .from("shops")
    .select("seller_account_id,country")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!shop) return null;

  const enabled = await isFeatureEnabled("trust_score", {
    sellerAccountId: shop.seller_account_id,
    country: shop.country,
  });
  if (!enabled) return null;

  const score = await getTrustTier(shop.seller_account_id);
  return score && isPublicTrustTier(score.tier) ? score.tier : null;
}
