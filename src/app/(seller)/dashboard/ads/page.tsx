import { randomUUID } from "node:crypto";

import { AdsBudgetForm } from "@/components/seller/ads-budget-form";
import { AdsCampaignControls } from "@/components/seller/ads-campaign-controls";
import { AdsCampaignForm } from "@/components/seller/ads-campaign-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { getAdsOverview, type AdCampaignView } from "@/lib/ads/service";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { formatMoney, type CurrencyCode } from "@snapduka/core";

export const dynamic = "force-dynamic";

const CAMPAIGN_STATE: Record<AdCampaignView["state"], { label: string; tone: BadgeTone }> = {
  active: { label: "Running", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
  out_of_funds: { label: "Out of budget", tone: "warn" },
  ended: { label: "Ended", tone: "neutral" },
};

/**
 * Promoted listings (ADR-0014): a prepaid budget, per-click campaigns and the
 * sponsored slot on /discover. Budget moves are owner-only (they spend the
 * withdrawable balance); campaign changes need `campaigns.manage`, so a
 * manager can run campaigns on the budget the owner funded.
 */
export default async function AdsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const overview = await getAdsOverview({ sellerAccountId: actor.sellerAccountId, country: actor.country });
  const header = (
    <PageHeader
      title="Promoted listings"
      sub="Your products in the Sponsored slot on Discover, charged per click. One click per viewer per day is billed, and a campaign pauses when the budget runs out."
    />
  );

  if (!overview.enabled) {
    return (
      <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
        {header}
        <Panel className="p-4.5">
          <h2 className="mb-1 text-[14px] font-bold">Promoted listings are not available yet</h2>
          <p className="text-[12.5px] leading-[1.6] text-ink-soft">
            We are opening them to shops gradually. They will appear here when they reach yours.
          </p>
        </Panel>
      </main>
    );
  }

  const { currency, prepaidMinor, availableMinor, policy, campaigns, promotable } = overview;
  const isOwner = !actor.role;
  const canManage = hasPermission(actor.role ?? "owner", "campaigns.manage");

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      {header}

      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4">
          <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,152,111,0.22)_0%,transparent_55%)]"
            />
            <div className="relative">
              <p className="mb-1.5 text-[12.5px] font-semibold text-[#B8AEA1]">Ad budget</p>
              <p className="font-serif text-[clamp(32px,4vw,40px)] font-medium tracking-[-0.01em]">
                {formatMoney(prepaidMinor, currency)}
              </p>
              <p className="mt-3 text-[12px] text-[#B8AEA1]">
                {formatMoney(availableMinor, currency)} available in your SnapDuka balance
              </p>
            </div>
          </div>

          {!policy ? (
            <Panel className="p-4.5">
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">
                Promoted listings are not available in your market yet.
              </p>
            </Panel>
          ) : null}

          {campaigns.length ? (
            <Panel className="overflow-hidden">
              <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Campaigns</h2>
              {campaigns.map((campaign) => (
                <CampaignRow key={campaign.id} campaign={campaign} currency={currency} canManage={canManage} />
              ))}
            </Panel>
          ) : (
            <Panel className="p-4.5">
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">No campaigns yet.</p>
            </Panel>
          )}
        </div>

        <div className="grid gap-4">
          {policy && isOwner ? (
            <AdsBudgetForm
              currency={currency}
              prepaidMinor={prepaidMinor}
              availableMinor={availableMinor}
              minTopUpMinor={policy.minTopUpMinor}
              initialKey={randomUUID()}
            />
          ) : null}
          {policy && !isOwner ? (
            <Panel className="p-4.5">
              <p className="text-[12.5px] leading-[1.6] text-ink-soft">
                Only the account owner can add to or withdraw from the ad budget.
              </p>
            </Panel>
          ) : null}
          {policy && canManage ? (
            <AdsCampaignForm
              currency={currency}
              products={promotable}
              maxProducts={policy.maxProductsPerCampaign}
              minBidMinor={policy.minBidMinor}
              maxBidMinor={policy.maxBidMinor}
              minDailyBudgetMinor={policy.minDailyBudgetMinor}
              maxDailyBudgetMinor={policy.maxDailyBudgetMinor}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function CampaignRow({
  campaign,
  currency,
  canManage,
}: {
  campaign: AdCampaignView;
  currency: CurrencyCode;
  canManage: boolean;
}) {
  const spec = CAMPAIGN_STATE[campaign.state];
  return (
    <div className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13.5px] font-bold text-ink">{campaign.name}</span>
        <Badge tone={spec.tone}>{spec.label}</Badge>
      </div>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">
        {formatMoney(campaign.bidMinor, currency)} per click · {formatMoney(campaign.dailyBudgetMinor, currency)} a day
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">
        Today: {campaign.clicksToday} {campaign.clicksToday === 1 ? "click" : "clicks"},{" "}
        {formatMoney(campaign.spentTodayMinor, currency)} · All time: {campaign.clicksTotal}{" "}
        {campaign.clicksTotal === 1 ? "click" : "clicks"}, {formatMoney(campaign.spentTotalMinor, currency)}
      </p>
      {campaign.products.length ? (
        <p className="mt-0.5 text-[11.5px] text-ink-soft">
          {campaign.products.map((product) => product.name).join(", ")}
        </p>
      ) : null}
      {canManage ? <AdsCampaignControls campaignId={campaign.id} state={campaign.state} /> : null}
    </div>
  );
}
