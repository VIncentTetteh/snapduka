import { settleCourierPayableAction } from "@/app/admin/protect-actions";
import { requireOperator } from "@/lib/auth/require-operator";
import Link from "next/link";

import { MetricTile } from "@/components/ui/metric-tile";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@snapduka/core";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@snapduka/core";

import { summariseOverview } from "./overview-metrics";

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
    { data: orderTotals },
    { count: activeSellers },
    { count: newSellers },
    { data: pendingPayouts },
    { data: pendingTotals },
    { count: openCases },
    { count: reviewCases },
    { data: recentAudit },
  ] = await Promise.all([
    // Aggregated in SQL, one row per currency. This fetched every paid order
    // of the last 30 days and summed them here, which db.max_rows = 1000 caps
    // silently: past a thousand paid orders a month, platform GMV and the paid
    // share simply stopped growing.
    admin.rpc("admin_order_totals_since", { p_since: since30d }),
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
    // The tile's count and total come from SQL. They were computed from the
    // five rows above, so the queue could never look longer than five.
    admin.rpc("admin_pending_payout_totals"),
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

  // North-star metrics for the trust-and-money strategy, aggregated in SQL.
  const { data: northStar } = await admin.rpc("admin_north_star", { p_weeks: 8 });
  // Couriers booked on SnapDuka's own account, not yet paid (courier_payable).
  const { data: courierOwed } = await admin
    .from("ledger_accounts")
    .select("currency,balance_minor")
    .eq("kind", "courier_payable")
    .gt("balance_minor", 0);

  const overview = summariseOverview(orderTotals ?? [], pendingTotals ?? []);
  const { gmvByCurrency, markets, primaryCurrency, orders30d, paidShare } = overview;
  const { pendingPayoutCount, pendingPayoutTotal, pendingPayoutCurrency } = overview;

  const dotClass = (action: string) =>
    action.startsWith("payout_approved") || action.startsWith("payout_paid")
      ? "bg-success"
      : action.startsWith("risk_") || action.includes("rejected")
        ? "bg-danger"
        : "bg-warn";

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader title="Overview" sub="Platform health across all markets · last 30 days" />

      {northStar && northStar.length > 0 ? (
        <Panel className="mb-6 overflow-x-auto p-4.5">
          <h2 className="mb-1 text-[14px] font-bold">North star · weekly</h2>
          <p className="mb-3 text-[12.5px] text-ink-soft">
            Transacting sellers (≥1 paid order that week) and GMV through SnapDuka Protect.
          </p>
          <table className="w-full min-w-[560px] text-left text-[12.5px]">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Week</th>
                <th className="py-1.5 pr-3 font-semibold">Transacting sellers</th>
                <th className="py-1.5 pr-3 font-semibold">GMV</th>
                <th className="py-1.5 pr-3 font-semibold">Protect GMV</th>
                <th className="py-1.5 pr-3 font-semibold">Protect share</th>
              </tr>
            </thead>
            <tbody>
              {northStar.map((row) => (
                <tr key={`${row.week_start}-${row.currency}`} className="border-t border-line-soft">
                  <td className="py-1.5 pr-3">{row.week_start}</td>
                  <td className="py-1.5 pr-3 font-semibold text-ink">{row.transacting_sellers}</td>
                  <td className="py-1.5 pr-3">{formatMoney(row.gmv_minor, row.currency as CurrencyCode)}</td>
                  <td className="py-1.5 pr-3">{formatMoney(row.protect_gmv_minor, row.currency as CurrencyCode)}</td>
                  <td className="py-1.5 pr-3">
                    {row.gmv_minor > 0 ? `${Math.round((row.protect_gmv_minor / row.gmv_minor) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      {(courierOwed ?? []).map((row) => (
        <Panel key={row.currency} className="mb-6 p-4.5">
          <h2 className="mb-1 text-[14px] font-bold">
            Owed to couriers · {formatMoney(row.balance_minor, row.currency as CurrencyCode)}
          </h2>
          <p className="mb-3 text-[12.5px] text-ink-soft">
            Deliveries booked on SnapDuka&apos;s courier accounts, already charged to sellers. Record each
            invoice when it is paid.
          </p>
          <form action={settleCourierPayableAction} className="flex flex-wrap items-end gap-2.5">
            <input type="hidden" name="currency" value={row.currency} />
            <input name="amount" required inputMode="decimal" aria-label="Amount paid" placeholder="Amount paid"
              className="h-10 rounded-[9px] border border-line-input bg-white px-3 text-[13px]" />
            <input name="reference" required aria-label="Invoice reference" placeholder="Invoice reference"
              className="h-10 rounded-[9px] border border-line-input bg-white px-3 text-[13px]" />
            <button className="min-h-10 cursor-pointer rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white">
              Record payment
            </button>
          </form>
        </Panel>
      ))}

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
          value={String(orders30d)}
          sub={`${paidShare}% paid via Paystack`}
        />
        <MetricTile
          label="Pending payouts"
          value={String(pendingPayoutCount)}
          sub={
            pendingPayoutTotal > 0
              ? formatMoney(pendingPayoutTotal, pendingPayoutCurrency)
              : "Queue clear"
          }
          subTone={pendingPayoutCount ? "warn" : "muted"}
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
