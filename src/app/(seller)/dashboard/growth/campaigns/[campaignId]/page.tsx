import Link from "next/link";
import { notFound } from "next/navigation";

import { CHANNEL_LABEL, shareCaption, shortLinkUrl, type CurrencyCode } from "@snapduka/core";
import { CampaignCreativeUploader } from "@/components/seller/campaign-creative-uploader";
import { CampaignForm } from "@/components/seller/campaign-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import {
  campaignCreativeUrl,
  fetchCampaignTotals,
  fetchLinkTotals,
  getCampaign,
  getCampaignLinks,
  getCampaignProducts,
  totalsFor,
  type CampaignStatus,
} from "@/lib/campaigns/campaigns";
import { formatPrice } from "@/lib/storefront/price";
import { createClient } from "@/lib/supabase/server";

import { updateCampaignRecord } from "../campaign-actions";

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: "neutral",
  active: "success",
  paused: "warn",
  ended: "neutral",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel as keyof typeof CHANNEL_LABEL] ?? "Other";
}

/**
 * One campaign.
 *
 * The two questions a seller actually has are "did this work?" and "where
 * should I post next time?", so the roll-up and the per-channel breakdown sit
 * together at the top rather than on separate screens.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const [{ campaignId }, { error, saved }] = await Promise.all([params, searchParams]);
  const campaign = await getCampaign(campaignId);
  if (!campaign) notFound();

  const [links, campaignTotals, linkTotals, products, origin, supabase] = await Promise.all([
    getCampaignLinks(campaignId),
    fetchCampaignTotals(),
    fetchLinkTotals(),
    getCampaignProducts(campaignId),
    appOrigin(),
    createClient(),
  ]);

  const { data: shop } = await supabase
    .from("shops")
    .select("currency,display_name")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  const currency = (shop?.currency ?? "GHS") as CurrencyCode;

  const stats = totalsFor(campaignTotals, campaign.id);
  const creative = campaignCreativeUrl(campaign.creative_path);
  const caption = shareCaption({ shopName: shop?.display_name ?? "my shop" });

  // Spend is hand-entered, so return is only worth showing once there is one.
  const returnLabel =
    campaign.spend_minor > 0
      ? `${(stats.revenueMinor / campaign.spend_minor).toFixed(1)}× on spend`
      : null;

  return (
    <main className="sd-main mx-auto max-w-[900px] px-4 pt-6 sm:px-6">
      <Link
        className="mb-3 inline-block text-[13px] font-semibold text-accent no-underline"
        href="/dashboard/growth/campaigns"
      >
        ← Campaigns
      </Link>
      <PageHeader
        title={campaign.name}
        sub={campaign.objective ?? undefined}
        actions={<Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>}
      />

      {error ? <p className="alert-error mb-4">{error}</p> : null}
      {saved ? <p className="alert-success mb-4">Saved.</p> : null}

      {/* Did it work? */}
      <Panel className="mb-5 p-4.5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {[
            { label: "Clicks", value: stats.clicks.toLocaleString() },
            { label: "Orders", value: stats.orders.toLocaleString() },
            { label: "Revenue", value: formatPrice(stats.revenueMinor, currency) },
            ...(campaign.budget_minor
              ? [{ label: "Budget", value: formatPrice(campaign.budget_minor, currency) }]
              : []),
            ...(campaign.spend_minor > 0
              ? [{ label: "Spent", value: formatPrice(campaign.spend_minor, currency) }]
              : []),
          ].map((metric) => (
            <div key={metric.label}>
              <p className="m-0 font-serif text-[28px] font-medium leading-none tracking-[-0.01em] text-ink">
                {metric.value}
              </p>
              <p className="mt-1 text-[12.5px] font-semibold text-ink-muted">{metric.label}</p>
            </div>
          ))}
        </div>
        {returnLabel ? (
          <p className="mt-3 border-t border-line-soft pt-3 text-[13px] text-ink-soft">
            {returnLabel}
          </p>
        ) : null}
      </Panel>

      {/* Where should I post next time? */}
      <h2 className="mb-3 text-[14px] font-bold">Links by channel</h2>
      {links.length === 0 ? (
        <EmptyState
          title="No links yet"
          body="Generate tracked links in Share Studio and they will appear here with their own numbers."
          action={
            <Link className="text-accent" href="/dashboard/share">
              Open Share Studio
            </Link>
          }
        />
      ) : (
        <div className="mb-6 grid gap-2.5">
          {links.map((link) => {
            const url = shortLinkUrl(origin, link.token);
            const perLink = linkTotals.get(link.id) ?? { clicks: 0, orders: 0 };
            return (
              <Panel className="p-3.5" key={link.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Badge tone="accent">{channelLabel(link.channel)}</Badge>
                  <span className="text-[13px] text-ink-soft">
                    <strong className="font-bold text-ink">{perLink.clicks}</strong> clicks ·{" "}
                    <strong className="font-bold text-ink">{perLink.orders}</strong> orders
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-full min-w-0 rounded-[10px] border border-line-input bg-white px-3 py-2 font-mono text-[12px] text-ink-soft"
                    readOnly
                    value={url}
                  />
                  <CopyButton value={`${caption}\n${url}`} />
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Creative */}
      <h2 className="mb-3 text-[14px] font-bold">Creative</h2>
      <Panel className="mb-6 overflow-hidden">
        {creative ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="aspect-[16/9] w-full object-cover" src={creative} />
        ) : (
          <span
            aria-hidden="true"
            className="block aspect-[16/9] w-full"
            style={{ background: gradientForSeed(campaign.id) }}
          />
        )}
        <div className="p-4.5">
          <CampaignCreativeUploader campaignId={campaign.id} hasCreative={Boolean(creative)} />
        </div>
      </Panel>

      {/* What it promotes */}
      {products.length > 0 ? (
        <>
          <h2 className="mb-3 text-[14px] font-bold">Promoting</h2>
          <div className="mb-6 grid gap-2">
            {products.map((product) => (
              <Panel className="flex items-center justify-between gap-3 p-3.5" key={product.id}>
                <span className="text-[13.5px] font-semibold text-ink">{product.name}</span>
                <span className="text-[13.5px] font-bold text-price">
                  {formatPrice(product.price_minor, product.currency as CurrencyCode)}
                </span>
              </Panel>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="mb-3 text-[14px] font-bold">Campaign details</h2>
      <Panel className="p-4.5">
        <CampaignForm
          action={updateCampaignRecord}
          campaign={campaign}
          currency={currency}
          submitLabel="Save changes"
        />
      </Panel>
    </main>
  );
}
