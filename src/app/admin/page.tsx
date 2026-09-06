import { requireOperator } from "@/lib/auth/require-operator";
import Link from "next/link";

import { MetricTile } from "@/components/ui/metric-tile";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function AdminOverviewPage() {
  // The layout redirects a non-operator; this is the handler's own check,
  // because every query below runs through the service-role client.
  await requireOperator("/admin");
  const admin = createAdminClient();
  const since30d = isoDaysAgo(30);

  const [
    { data: paidOrders },
    { count: orders30d },
    { count: activeSellers },
    { count: newSellers },
    { data: pendingPayouts },
    { count: openCases },
    { count: reviewCases },
    { data: recentAudit },
  ] = await Promise.all([
    admin
      .from("orders")
      .select("total_minor,currency")
      .eq("payment_status", "paid")
      .gte("created_at", since30d),
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since30d),
    admin
      .from("seller_accounts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin
      .from("seller_accounts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since30d),
    admin
      .from("payout_requests")
      .select("id,reference,amount_minor,currency,created_at,seller_accounts(contact_name)")
      .eq("status", "requested")
      .order("created_at", { ascending: true })
      .limit(5),
    admin
      .from("support_cases")
      .select("id", { count: "exact", head: true })
      .in("status", ["opened", "seller_response_due", "under_review"]),
    admin
      .from("support_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "under_review"),
    admin
      .from("audit_events")
      .select("id,action,entity_type,occurred_at,after_data")
      .order("occurred_at", { ascending: false })
      .limit(6),
  ]);

  const gmvByCurrency = (paidOrders ?? []).reduce<Record<string, number>>((acc, order) => {
    acc[order.currency] = (acc[order.currency] ?? 0) + order.total_minor;
    return acc;
  }, {});
  const markets = Object.keys(gmvByCurrency);
  const primaryCurrency = (markets.sort(
    (a, b) => gmvByCurrency[b] - gmvByCurrency[a],
  )[0] ?? "GHS") as CurrencyCode;
  const paidCount = paidOrders?.length ?? 0;
  const paidShare = orders30d ? Math.round((paidCount / orders30d) * 100) : 0;
  const pendingPayoutTotal = (pendingPayouts ?? []).reduce(
    (sum, payout) => sum + payout.amount_minor,
    0,
  );
  const pendingPayoutCurrency = (pendingPayouts?.[0]?.currency ?? primaryCurrency) as CurrencyCode;

  const dotClass = (action: string) =>
    action.startsWith("payout_approved") || action.startsWith("payout_paid")
      ? "bg-success"
      : action.startsWith("risk_") || action.includes("rejected")
        ? "bg-danger"
        : "bg-warn";

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader title="Overview" sub="Platform health across all markets · last 30 days" />

      {/* Metric tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <MetricTile
          label="GMV · 30 days"
          value={formatMoney(gmvByCurrency[primaryCurrency] ?? 0, primaryCurrency)}
          sub={`Across ${Math.max(markets.length, 1)} ${markets.length === 1 ? "market" : "markets"}`}
        />
        <MetricTile
          label="Active sellers"
          value={String(activeSellers ?? 0)}
          sub={`${newSellers ?? 0} new`}
          subTone="success"
        />
        <MetricTile
          label="Orders · 30 days"
          value={String(orders30d ?? 0)}
          sub={`${paidShare}% paid via Paystack`}
        />
        <MetricTile
          label="Pending payouts"
          value={String(pendingPayouts?.length ?? 0)}
          sub={
            pendingPayoutTotal > 0
              ? formatMoney(pendingPayoutTotal, pendingPayoutCurrency)
              : "Queue clear"
          }
          subTone={pendingPayouts?.length ? "warn" : "muted"}
        />
        <MetricTile
          label="Open cases"
          value={String(openCases ?? 0)}
          sub={`${reviewCases ?? 0} under review`}
          subTone={reviewCases ? "warn" : "muted"}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Needs attention */}
        <Panel className="overflow-hidden">
          <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
            Needs attention
          </h2>
          {!pendingPayouts?.length && !openCases ? (
            <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
              Nothing waiting on you right now.
            </p>
          ) : (
            <>
              {(pendingPayouts ?? []).map((payout) => {
                const seller = payout.seller_accounts as
                  | { contact_name?: string }
                  | { contact_name?: string }[]
                  | null;
                const sellerName = Array.isArray(seller)
                  ? seller[0]?.contact_name
                  : seller?.contact_name;
                return (
                  <Link
                    key={payout.id}
                    href="/admin/payouts"
                    className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
                  >
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink">
                        Payout {payout.reference} · {sellerName ?? "Seller"}
                      </span>
                      <span className="block text-[12px] text-ink-muted">
                        Requested {new Date(payout.created_at).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="text-[13.5px] font-bold text-ink">
                      {formatMoney(payout.amount_minor, payout.currency as CurrencyCode)}
                    </span>
                  </Link>
                );
              })}
              {openCases ? (
                <Link
                  href="/admin/cases"
                  className="block border-b border-[#F7F2EA] px-4.5 py-3 text-[13.5px] font-semibold text-ink no-underline transition-colors last:border-b-0 hover:bg-paper"
                >
                  {openCases} open support {openCases === 1 ? "case" : "cases"} →
                </Link>
              ) : null}
            </>
          )}
        </Panel>

        {/* Recent audit activity */}
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4.5 py-3.5">
            <h2 className="text-[14px] font-bold">Recent audit activity</h2>
            <Link
              href="/admin/audit"
              className="text-[12.5px] font-bold text-accent no-underline hover:text-accent-deep"
            >
              View log →
            </Link>
          </div>
          {!recentAudit?.length ? (
            <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
              No operator actions recorded yet.
            </p>
          ) : (
            recentAudit.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 flex-none rounded-full ${dotClass(event.action)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold capitalize text-ink">
                    {event.action.replace(/_/g, " ")} · {event.entity_type.replace(/_/g, " ")}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    {new Date(event.occurred_at).toLocaleString()}
                  </span>
                </span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </main>
  );
}
