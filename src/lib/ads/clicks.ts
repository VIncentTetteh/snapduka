import "server-only";

import { decodeClickToken } from "@/lib/ads/click-token";
import { fallbackVisitorKey } from "@/lib/campaigns/attribution";
import { isNonHumanRequest } from "@/lib/campaigns/bots";
import { isFeatureEnabled } from "@/lib/flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Handles one click on a sponsored slot: always sends the visitor to the
 * product, and bills the advertiser only when every check passes.
 *
 * Fraud controls, cheapest first (ADR-0014):
 *   1. the token must verify (signed at render, 6-hour life) — no minted clicks;
 *   2. link-preview crawlers, prefetches and scripts are dropped (campaigns/bots);
 *   3. at most IP_CLICK_LIMIT billable clicks per IP per hour across all ads;
 *   4. one billed click per campaign per viewer per UTC day (record_ad_click).
 * The viewer key is an HMAC of IP + user agent + campaign, deliberately NOT the
 * visitor cookie: a cookie is client-chosen, so a competitor could rotate it to
 * drain another seller's budget. Carrier NAT means some real people share a
 * key; that undercounts, which is the direction a seller can live with.
 */

const IP_CLICK_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

export type AdClickRequest = {
  token: string | null;
  ip: string;
  userAgent: string | null;
  purpose: string | null;
  secPurpose: string | null;
  secFetchMode: string | null;
};

export type AdClickResult = {
  /** Path to send the visitor to. */
  destination: string;
  outcome: "billed" | "duplicate" | "inactive" | "over_budget" | "out_of_funds" | "invalid" | "bot" | "rate_limited" | "error";
};

const FALLBACK_DESTINATION = "/discover";

export async function handleAdClick(request: AdClickRequest): Promise<AdClickResult> {
  const payload = decodeClickToken(request.token);
  if (!payload) return { destination: FALLBACK_DESTINATION, outcome: "invalid" };

  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products")
    .select("id,seller_account_id,shops!inner(slug)")
    .eq("id", payload.productId)
    .maybeSingle();
  const shop = product ? (Array.isArray(product.shops) ? product.shops[0] : product.shops) : null;
  if (!product || !shop?.slug) return { destination: FALLBACK_DESTINATION, outcome: "invalid" };
  const destination = `/${shop.slug}/products/${product.id}`;

  if (
    isNonHumanRequest({
      userAgent: request.userAgent,
      purpose: request.purpose,
      secPurpose: request.secPurpose,
      secFetchMode: request.secFetchMode,
    })
  ) {
    return { destination, outcome: "bot" };
  }

  const limited = await checkRateLimit(`ads:click:${request.ip}`, IP_CLICK_LIMIT);
  if (!limited.ok) return { destination, outcome: "rate_limited" };

  // Re-checked at click time: turning the flag off for a seller stops billing
  // for links already on screen, not just new impressions.
  if (!(await isFeatureEnabled("promoted_listings", { sellerAccountId: product.seller_account_id }))) {
    return { destination, outcome: "inactive" };
  }

  const viewerKey = fallbackVisitorKey({
    ip: request.ip,
    userAgent: request.userAgent ?? "unknown",
    campaignId: payload.campaignId,
  });
  const { data: outcome, error } = await admin.rpc("record_ad_click", {
    p_campaign_id: payload.campaignId,
    p_product_id: payload.productId,
    p_viewer_key: viewerKey,
    p_price_minor: payload.priceMinor,
    p_placement: payload.placement,
  });
  if (error) {
    // Billing is never allowed to break the redirect.
    console.error("[ads] click could not be recorded", error.message);
    return { destination, outcome: "error" };
  }
  const known = ["billed", "duplicate", "inactive", "over_budget", "out_of_funds"] as const;
  const result = known.find((value) => value === outcome) ?? "error";
  return { destination, outcome: result };
}
