import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { fetchAnalyticsSummary } from "@/lib/analytics/summary";

const TOOLS = [
  {
    href: "/dashboard/growth/promotions",
    label: "Promotions",
    body: "Discount codes and launch campaigns for your storefront.",
  },
  {
    href: "/dashboard/growth/campaigns",
    label: "Campaigns",
    body: "Tracked links per channel so you know what converts.",
  },
  {
    href: "/dashboard/growth/segments",
    label: "Segments",
    body: "Group customers by behaviour for targeted outreach.",
  },
  {
    href: "/dashboard/growth/broadcasts",
    label: "Broadcasts",
    body: "Send updates to customers who opted in.",
  },
  {
    href: "/dashboard/growth/insights",
    label: "Insights",
    body: "Deeper analytics across products, channels and repeat buyers.",
  },
  {
    href: "/dashboard/growth/profit",
    label: "Profit",
    body: "Revenue, cost, and margin per product.",
  },
  {
    href: "/dashboard/share",
    label: "Share Studio",
    body: "Short links, captions and story cards for every channel.",
  },
] as const;

export default async function GrowthPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  // One aggregated call. This used to be three head counts plus every order row
  // pulled back to count the paid ones — and that order query had no bound, so
  // it was the same db.max_rows trap as the event counts, just unnoticed.
  const summary = await fetchAnalyticsSummary();

  const hasData = summary.visits > 0 || summary.paidOrders > 0;
  const share = (value: number) =>
    summary.visits > 0 ? Math.round((value / summary.visits) * 100) : 0;

  // A true funnel: each step is a subset of the one above, so the percentages
  // mean something. Product views are deliberately NOT a step — one visitor
  // views several products, so views routinely exceed visits (975 visits to
  // 1,550 views on the demo shop) and a "159%" bar would be nonsense.
  const funnel = [
    { label: "Store visits", value: summary.visits, pct: 100 },
    { label: "Checkout starts", value: summary.checkoutStarts, pct: share(summary.checkoutStarts) },
    { label: "Paid orders", value: summary.paidOrders, pct: share(summary.paidOrders) },
  ];

  // Reported alongside the funnel instead, as depth per visit — which is what
  // the number actually measures.
  const viewsPerVisit = summary.visits > 0 ? summary.productViews / summary.visits : 0;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Growth"
        sub="See what converts, then use the tools that move the numbers."
      />

      {/* Conversion funnel */}
      <Panel className="mb-5 p-4.5">
        <h2 className="mb-1 text-[14px] font-bold">Conversion funnel</h2>
        <p className="mb-4 text-[12.5px] text-ink-muted">All time</p>
        {!hasData ? (
          <EmptyState
            title="Not enough data yet"
            body="Share your storefront to start collecting visits — your funnel builds itself from there."
          />
        ) : (
          <div className="grid gap-3">
            {funnel.map((step, index) => (
              <div key={step.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-ink">{step.label}</span>
                  <span className="text-[13px] text-ink-soft">
                    <strong className="font-bold text-ink">{step.value.toLocaleString()}</strong>
                    {index > 0 ? ` · ${step.pct}%` : ""}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-line-soft">
                  <div
                    className={`h-full rounded-full ${index === funnel.length - 1 ? "bg-success" : "bg-accent-soft"}`}
                    style={{ width: `${Math.max(step.pct, step.value > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
            {summary.productViews > 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-muted">
                {summary.productViews.toLocaleString()} product views —{" "}
                {viewsPerVisit.toFixed(1)} per visit.
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      {/* Growth tools */}
      <h2 className="mb-3 text-[14px] font-bold">Growth tools</h2>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="rounded-2xl border border-line bg-white p-4.5 no-underline transition-colors hover:border-[#B9AC98]"
          >
            <h3 className="mb-1 text-[14.5px] font-bold text-ink">{tool.label}</h3>
            <p className="text-[12.5px] leading-[1.55] text-ink-soft">{tool.body}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
