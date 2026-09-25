import "server-only";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Promoted listings, seller side (ADR-0014, flag `promoted_listings`). Every
 * money and validation rule lives in SQL (202609250222); this module gates on
 * the flag and shapes data for the web page and the mobile API. Reads use the
 * service-role client, so every query names the seller explicitly.
 */

export type AdCampaignView = {
  id: string;
  name: string;
  state: "active" | "paused" | "out_of_funds" | "ended";
  bidMinor: number;
  dailyBudgetMinor: number;
  clicksToday: number;
  spentTodayMinor: number;
  clicksTotal: number;
  spentTotalMinor: number;
  products: { id: string; name: string }[];
  createdAt: string;
};

export type AdPolicyView = {
  minBidMinor: number;
  maxBidMinor: number;
  minDailyBudgetMinor: number;
  maxDailyBudgetMinor: number;
  minTopUpMinor: number;
  maxProductsPerCampaign: number;
};

export type AdsOverview =
  | { enabled: false }
  | {
      enabled: true;
      currency: CurrencyCode;
      prepaidMinor: number;
      availableMinor: number;
      policy: AdPolicyView | null;
      campaigns: AdCampaignView[];
      /** Active products the seller could promote (newest 100). */
      promotable: { id: string; name: string; priceMinor: number }[];
    };

const CURRENCY: Record<CountryCode, CurrencyCode> = { GH: "GHS", NG: "NGN", CI: "XOF" };

export function currencyForCountry(country: CountryCode): CurrencyCode {
  return CURRENCY[country];
}

export async function adsEnabledFor(sellerAccountId: string): Promise<boolean> {
  return isFeatureEnabled("promoted_listings", { sellerAccountId });
}

export async function getAdsOverview(input: { sellerAccountId: string; country: CountryCode }): Promise<AdsOverview> {
  if (!(await adsEnabledFor(input.sellerAccountId))) return { enabled: false };
  const admin = createAdminClient();
  const currency = currencyForCountry(input.country);

  const [prepaid, wallet, policy, campaigns, stats, products] = await Promise.all([
    admin.rpc("ads_prepaid_balance", { p_seller_account_id: input.sellerAccountId, p_currency: currency }),
    admin
      .from("ledger_accounts")
      .select("balance_minor")
      .eq("owner_seller_account_id", input.sellerAccountId)
      .eq("kind", "seller_available")
      .eq("currency", currency)
      .maybeSingle(),
    admin
      .from("ad_policies")
      .select(
        "min_bid_minor,max_bid_minor,min_daily_budget_minor,max_daily_budget_minor,min_top_up_minor,max_products_per_campaign",
      )
      .eq("country", input.country)
      .maybeSingle(),
    admin
      .from("ad_campaigns")
      .select("id,name,state,bid_minor,daily_budget_minor,created_at,ad_campaign_products(product_id,products(id,name))")
      .eq("seller_account_id", input.sellerAccountId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin.rpc("seller_ad_campaign_stats", { p_seller_account_id: input.sellerAccountId }),
    admin
      .from("products")
      .select("id,name,price_minor")
      .eq("seller_account_id", input.sellerAccountId)
      .eq("status", "active")
      .eq("moderation_status", "clear")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  for (const result of [prepaid, wallet, policy, campaigns, stats, products]) {
    if (result.error) throw new Error(`ads overview read failed: ${result.error.message}`);
  }

  const statsById = new Map((stats.data ?? []).map((row) => [row.campaign_id, row]));
  return {
    enabled: true,
    currency,
    prepaidMinor: prepaid.data ?? 0,
    availableMinor: wallet.data?.balance_minor ?? 0,
    policy: policy.data
      ? {
          minBidMinor: policy.data.min_bid_minor,
          maxBidMinor: policy.data.max_bid_minor,
          minDailyBudgetMinor: policy.data.min_daily_budget_minor,
          maxDailyBudgetMinor: policy.data.max_daily_budget_minor,
          minTopUpMinor: policy.data.min_top_up_minor,
          maxProductsPerCampaign: policy.data.max_products_per_campaign,
        }
      : null,
    campaigns: (campaigns.data ?? []).map((row) => {
      const stat = statsById.get(row.id);
      return {
        id: row.id,
        name: row.name,
        state: row.state,
        bidMinor: row.bid_minor,
        dailyBudgetMinor: row.daily_budget_minor,
        clicksToday: stat?.clicks_today ?? 0,
        spentTodayMinor: stat?.spent_today_minor ?? 0,
        clicksTotal: stat?.clicks_total ?? 0,
        spentTotalMinor: stat?.spent_total_minor ?? 0,
        createdAt: row.created_at,
        products: (row.ad_campaign_products ?? []).flatMap((link) => {
          const product = Array.isArray(link.products) ? link.products[0] : link.products;
          return product ? [{ id: product.id, name: product.name }] : [];
        }),
      };
    }),
    promotable: (products.data ?? []).map((row) => ({ id: row.id, name: row.name, priceMinor: row.price_minor })),
  };
}

/** `value` is the new campaign id, the campaign's new state, or null. */
export type AdsActionResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "disabled" | "refused"; message: string };

const DISABLED = { ok: false as const, reason: "disabled" as const, message: "Promoted listings are not available for your shop yet." };

/** The SQL functions raise with messages written for the seller; surface them. */
function refused(message: string | undefined): { ok: false; reason: "refused"; message: string } {
  return { ok: false, reason: "refused", message: message ?? "That could not be done." };
}

export async function createAdCampaign(input: {
  sellerAccountId: string;
  userId: string;
  name: string;
  productIds: string[];
  dailyBudgetMinor: number;
  bidMinor: number;
}): Promise<AdsActionResult> {
  if (!(await adsEnabledFor(input.sellerAccountId))) return DISABLED;
  const { data, error } = await createAdminClient().rpc("create_ad_campaign", {
    p_seller_account_id: input.sellerAccountId,
    p_name: input.name,
    p_product_ids: input.productIds,
    p_daily_budget_minor: input.dailyBudgetMinor,
    p_bid_minor: input.bidMinor,
    p_created_by: input.userId,
  });
  if (error || !data) return refused(error?.message);
  return { ok: true, value: data };
}

export type CampaignAction =
  | { action: "pause" | "resume" | "end" }
  | { action: "update_terms"; dailyBudgetMinor: number; bidMinor: number };

export async function updateAdCampaign(input: {
  sellerAccountId: string;
  campaignId: string;
  change: CampaignAction;
}): Promise<AdsActionResult> {
  if (!(await adsEnabledFor(input.sellerAccountId))) return DISABLED;
  const { data, error } = await createAdminClient().rpc("update_ad_campaign", {
    p_campaign_id: input.campaignId,
    p_seller_account_id: input.sellerAccountId,
    p_action: input.change.action,
    p_daily_budget_minor: input.change.action === "update_terms" ? input.change.dailyBudgetMinor : undefined,
    p_bid_minor: input.change.action === "update_terms" ? input.change.bidMinor : undefined,
  });
  if (error || !data) return refused(error?.message);
  return { ok: true, value: data };
}

/**
 * Moves money between the seller's available balance and their ad budget.
 * Keyed on the caller's idempotency key so a double-submit moves money once.
 */
export async function moveAdBudget(input: {
  sellerAccountId: string;
  direction: "top_up" | "withdraw";
  amountMinor: number;
  idempotencyKey: string;
}): Promise<AdsActionResult> {
  if (!(await adsEnabledFor(input.sellerAccountId))) return DISABLED;
  const args = {
    p_seller_account_id: input.sellerAccountId,
    p_amount_minor: input.amountMinor,
    p_idempotency_key: input.idempotencyKey,
  };
  const admin = createAdminClient();
  const { error } =
    input.direction === "top_up" ? await admin.rpc("ads_top_up", args) : await admin.rpc("ads_withdraw", args);
  if (error) return refused(error.message);
  return { ok: true, value: null };
}
