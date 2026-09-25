import "server-only";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { encodeClickToken } from "@/lib/ads/click-token";
import { isFeatureEnabled } from "@/lib/flags";
import { publicMediaUrl } from "@/lib/storefront/media";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The "Sponsored" slot on /discover (flag `promoted_listings`, ADR-0014).
 *
 * The auction runs in SQL (sponsored_listings): generalised second price with
 * a reserve, one slot per seller, and only campaigns that are funded, within
 * today's budget and whose seller has the flag. This module adds the market
 * gate (the flag for the viewer's country), turns each winner into a signed
 * click link carrying the price it won at, and never lets an ads failure take
 * the directory down with it.
 */

export type SponsoredListing = {
  campaignId: string;
  productId: string;
  productName: string;
  priceMinor: number;
  currency: CurrencyCode;
  shopName: string;
  shopSlug: string;
  imageUrl: string | null;
  /** Signed redirect; the click is billed there, not here. */
  href: string;
};

export async function getSponsoredListings(input: {
  country: CountryCode;
  placement: "discover";
  limit?: number;
  now?: number;
}): Promise<SponsoredListing[]> {
  try {
    if (!(await isFeatureEnabled("promoted_listings", { country: input.country }))) return [];
    const { data, error } = await createAdminClient().rpc("sponsored_listings", {
      p_country: input.country,
      p_limit: input.limit,
    });
    if (error) {
      console.error("[ads] sponsored_listings failed; showing none", error.message);
      return [];
    }
    const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
    return (data ?? []).map((row) => ({
      campaignId: row.campaign_id,
      productId: row.product_id,
      productName: row.product_name,
      priceMinor: row.price_minor,
      currency: row.currency,
      shopName: row.shop_name,
      shopSlug: row.shop_slug,
      imageUrl: publicMediaUrl(row.image_path),
      href: `/api/ads/click?t=${encodeURIComponent(
        encodeClickToken({
          campaignId: row.campaign_id,
          productId: row.product_id,
          priceMinor: row.cost_per_click_minor,
          placement: input.placement,
          issuedAt,
        }),
      )}`,
    }));
  } catch (error) {
    console.error("[ads] sponsored listings unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}
