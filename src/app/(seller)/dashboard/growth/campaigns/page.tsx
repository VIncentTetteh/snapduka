import Link from "next/link";

import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { ButtonLink } from "@/components/ui/button";
import { resolveServerActor } from "@/lib/auth/actor";
import {
  campaignCreativeUrl,
  fetchCampaignTotals,
  listCampaigns,
  totalsFor,
  type CampaignStatus,
} from "@/lib/campaigns/campaigns";
import { formatPrice } from "@/lib/storefront/price";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@snapduka/core";

/**
 * Campaigns.
 *
 * This screen used to list `campaign_links` — one row per channel, named
 * "Storefront · instagram" — which meant a seller saw four unrelated things
 * where they had run one campaign, with no name, no dates and no total. It now
 * lists campaigns, and the links live inside them.
 */

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: "neutral",
  active: "success",
  paused: "warn",
  ended: "neutral",
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

function dateRange(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (value: string) => new Date(value).toLocaleDateString(undefined, DATE_FORMAT);
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  return startsAt ? `From ${fmt(startsAt)}` : `Until ${fmt(endsAt!)}`;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const [{ error }, supabase, campaigns, totals] = await Promise.all([
    searchParams,
    createClient(),
    listCampaigns(),
    fetchCampaignTotals(),
  ]);

  const { data: shop } = await supabase
    .from("shops")
    .select("currency")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  const currency = (shop?.currency ?? "GHS") as CurrencyCode;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Growth"
        title="Campaigns"
        sub="A campaign is one push — a name, a goal, and the links you post for it."
        actions={<ButtonLink href="/dashboard/growth/campaigns/new">New campaign</ButtonLink>}
      />

      {error ? <p className="alert-error mb-4">{error}</p> : null}

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="Start one to give a push a name, a goal and a set of tracked links — then see what it actually did."
          action={
            <ButtonLink href="/dashboard/growth/campaigns/new">New campaign</ButtonLink>
          }
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {campaigns.map((campaign) => {
            const stats = totalsFor(totals, campaign.id);
            const creative = campaignCreativeUrl(campaign.creative_path);
            const range = dateRange(campaign.starts_at, campaign.ends_at);

            return (
              <Link
                className="block no-underline"
                href={`/dashboard/growth/campaigns/${campaign.id}`}
                key={campaign.id}
              >
                <Panel className="h-full overflow-hidden transition-colors hover:border-[#B9AC98]">
                  {/* A campaign with no creative gets its deterministic warm
                      swatch rather than a grey box, the same as a product. */}
                  {creative ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                      src={creative}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="block aspect-[16/9] w-full"
                      style={{ background: gradientForSeed(campaign.id) }}
                    />
                  )}

                  <div className="p-4.5">
                    <div className="mb-1.5 flex items-start justify-between gap-2.5">
                      <h2 className="m-0 font-serif text-[19px] font-medium leading-tight text-ink">
                        {campaign.name}
                      </h2>
                      <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
                    </div>

                    {campaign.objective ? (
                      <p className="mb-2 line-clamp-2 text-[13px] leading-[1.5] text-ink-soft">
                        {campaign.objective}
                      </p>
                    ) : null}

                    {range ? (
                      <p className="mb-3 text-[12px] text-ink-muted">{range}</p>
                    ) : null}

                    <dl className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line-soft pt-3">
                      <div>
                        <dd className="m-0 font-serif text-[19px] font-medium leading-none text-ink">
                          {stats.clicks.toLocaleString()}
                        </dd>
                        <dt className="text-[11.5px] text-ink-muted">clicks</dt>
                      </div>
                      <div>
                        <dd className="m-0 font-serif text-[19px] font-medium leading-none text-ink">
                          {stats.orders.toLocaleString()}
                        </dd>
                        <dt className="text-[11.5px] text-ink-muted">orders</dt>
                      </div>
                      <div>
                        <dd className="m-0 font-serif text-[19px] font-medium leading-none text-price">
                          {formatPrice(stats.revenueMinor, currency)}
                        </dd>
                        <dt className="text-[11.5px] text-ink-muted">revenue</dt>
                      </div>
                    </dl>
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
