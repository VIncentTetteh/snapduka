import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { requireOperator } from "@/lib/auth/require-operator";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, type CurrencyCode } from "@snapduka/core";

export const dynamic = "force-dynamic";

const CAMPAIGN_LIMIT = 100;
/** Sellers whose campaign stats are fetched (one RPC each). */
const STATS_SELLER_LIMIT = 20;
const CURRENCIES: CurrencyCode[] = ["GHS", "NGN", "XOF"];

const STATE_TONE: Record<string, BadgeTone> = {
  active: "success",
  paused: "neutral",
  out_of_funds: "warn",
  ended: "neutral",
};

type CampaignStats = { clicksToday: number; spentTodayMinor: number; clicksTotal: number; spentTotalMinor: number };

/**
 * Promoted listings, operator view (read-only, ADR-0014).
 *
 * Aggregates are deliberately bounded. Selecting ad_clicks to count or sum them
 * would be silently cut at db.max_rows = 1000 (see the analytics row-cap
 * incident), so:
 *  - today's billed click COUNT per currency is an exact head-only count, which
 *    PostgREST computes in SQL and does not truncate;
 *  - REVENUE and per-campaign figures come from seller_ad_campaign_stats (which
 *    aggregates in SQL) for the sellers of the listed campaigns, at most
 *    STATS_SELLER_LIMIT of them. No platform-wide revenue RPC exists yet, so the
 *    revenue figure is labelled as covering only those sellers; the ledger's
 *    ads_revenue account (and check_financial_product_invariants) is the
 *    authoritative total.
 */
export default async function AdminAdsPage() {
  await requireOperator("/admin/ads");
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // click_date is a UTC day

  const [policies, campaigns, ...clickCounts] = await Promise.all([
    admin
      .from("ad_policies")
      .select(
        "country,min_bid_minor,max_bid_minor,min_daily_budget_minor,max_daily_budget_minor,min_top_up_minor,sponsored_slots,max_products_per_campaign",
      )
      .order("country"),
    admin
      .from("ad_campaigns")
      .select("id,seller_account_id,name,state,currency,bid_minor,daily_budget_minor,created_at,seller_accounts(contact_name)")
      .order("created_at", { ascending: false })
      .limit(CAMPAIGN_LIMIT),
    ...CURRENCIES.map((currency) =>
      admin
        .from("ad_clicks")
        .select("id", { count: "exact", head: true })
        .eq("click_date", today)
        .eq("currency", currency),
    ),
  ]);

  const sellerIds = [...new Set((campaigns.data ?? []).map((campaign) => campaign.seller_account_id))].slice(
    0,
    STATS_SELLER_LIMIT,
  );
  const statsResults = await Promise.all(
    sellerIds.map((sellerId) => admin.rpc("seller_ad_campaign_stats", { p_seller_account_id: sellerId })),
  );
  const stats = new Map<string, CampaignStats>();
  for (const result of statsResults) {
    for (const row of result.data ?? []) {
      stats.set(row.campaign_id, {
        clicksToday: row.clicks_today,
        spentTodayMinor: row.spent_today_minor,
        clicksTotal: row.clicks_total,
        spentTotalMinor: row.spent_total_minor,
      });
    }
  }

  const revenueToday = new Map<CurrencyCode, number>();
  for (const campaign of campaigns.data ?? []) {
    const stat = stats.get(campaign.id);
    if (stat) revenueToday.set(campaign.currency, (revenueToday.get(campaign.currency) ?? 0) + stat.spentTodayMinor);
  }

  const readError = [policies, campaigns, ...clickCounts, ...statsResults].find((result) => result.error)?.error;

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader title="Promoted listings" sub="Read-only. Sellers manage their own campaigns and budgets." />

      {readError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          Could not load everything: {readError.message}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {CURRENCIES.map((currency, index) => (
          <Panel key={currency} className="p-4">
            <p className="text-[12px] font-semibold text-ink-muted">Billed clicks today · {currency}</p>
            <p className="mt-0.5 font-serif text-[22px] font-medium text-ink">{clickCounts[index]?.count ?? 0}</p>
            <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-soft">
              {formatMoney(revenueToday.get(currency) ?? 0, currency)} revenue across the {sellerIds.length} sellers
              listed below
            </p>
          </Panel>
        ))}
      </div>

      <Panel className="mb-4 overflow-x-auto p-4">
        <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Market policies</h2>
        <table className="w-full text-left text-[12.5px]">
          <thead className="text-ink-muted">
            <tr>
              {["Market", "Bid range", "Daily budget range", "Min top-up", "Slots", "Products / campaign"].map(
                (heading) => (
                  <th key={heading} className="px-4.5 py-2 font-semibold">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(policies.data ?? []).map((policy) => {
              const currency: CurrencyCode = policy.country === "NG" ? "NGN" : policy.country === "CI" ? "XOF" : "GHS";
              return (
                <tr key={policy.country} className="border-t border-[#F7F2EA]">
                  <td className="px-4.5 py-2 font-bold">{policy.country}</td>
                  <td className="px-4.5 py-2">
                    {formatMoney(policy.min_bid_minor, currency)} to {formatMoney(policy.max_bid_minor, currency)}
                  </td>
                  <td className="px-4.5 py-2">
                    {formatMoney(policy.min_daily_budget_minor, currency)} to{" "}
                    {formatMoney(policy.max_daily_budget_minor, currency)}
                  </td>
                  <td className="px-4.5 py-2">{formatMoney(policy.min_top_up_minor, currency)}</td>
                  <td className="px-4.5 py-2">{policy.sponsored_slots}</td>
                  <td className="px-4.5 py-2">{policy.max_products_per_campaign}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <h2 className="mb-2 text-[14px] font-bold">Campaigns (newest {CAMPAIGN_LIMIT})</h2>
      {!campaigns.data?.length ? (
        <EmptyState title="No campaigns yet" />
      ) : (
        <Panel className="overflow-x-auto p-4">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-ink-muted">
              <tr>
                {["Campaign", "Seller", "State", "Bid", "Daily budget", "Today", "All time"].map((heading) => (
                  <th key={heading} className="px-4.5 py-2 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.data.map((campaign) => {
                const seller = Array.isArray(campaign.seller_accounts)
                  ? campaign.seller_accounts[0]
                  : campaign.seller_accounts;
                const stat = stats.get(campaign.id);
                return (
                  <tr key={campaign.id} className="border-t border-[#F7F2EA] align-top">
                    <td className="px-4.5 py-2 font-bold">{campaign.name}</td>
                    <td className="px-4.5 py-2">
                      {seller?.contact_name ?? "Seller"}
                      <span className="block font-mono text-[11px] text-ink-muted">{campaign.seller_account_id}</span>
                    </td>
                    <td className="px-4.5 py-2">
                      <Badge tone={STATE_TONE[campaign.state] ?? "neutral"}>{campaign.state}</Badge>
                    </td>
                    <td className="px-4.5 py-2">{formatMoney(campaign.bid_minor, campaign.currency)}</td>
                    <td className="px-4.5 py-2">{formatMoney(campaign.daily_budget_minor, campaign.currency)}</td>
                    <td className="px-4.5 py-2">
                      {stat
                        ? `${stat.clicksToday} · ${formatMoney(stat.spentTodayMinor, campaign.currency)}`
                        : "Not loaded"}
                    </td>
                    <td className="px-4.5 py-2">
                      {stat
                        ? `${stat.clicksTotal} · ${formatMoney(stat.spentTotalMinor, campaign.currency)}`
                        : "Not loaded"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </main>
  );
}
