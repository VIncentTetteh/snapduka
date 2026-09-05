import Link from "next/link";

import { MetricTile } from "@/components/ui/metric-tile";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { fetchAnalyticsSummary } from "@/lib/analytics/summary";

/** The dashboards report all time. */
const EPOCH = "1970-01-01T00:00:00Z";

export default async function InsightsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  // The rates come from seller_analytics_summary, which aggregates in Postgres.
  // They used to be derived in JavaScript from every order row for the seller —
  // an unbounded select, so past db.max_rows the denominators quietly stopped
  // growing and every rate on this page drifted.
  //
  // Top products had exactly the same bug, directly beneath that comment: it
  // pulled every order line the seller had ever sold and tallied them here, so
  // the ranking was computed from whatever thousand rows came back. Now ordered
  // and limited in SQL, so the answer is exact and the response is bounded by
  // the ten rows actually displayed.
  const [summary, { data: topProducts }] = await Promise.all([
    fetchAnalyticsSummary(),
    supabase.rpc("seller_top_products", { p_from: EPOCH, p_to: new Date().toISOString(), p_limit: 10 }),
  ]);
  const rate = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
  const metrics = {
    checkoutRate: rate(summary.checkoutStarts, summary.visits),
    orderRate: rate(summary.ordersPlaced, summary.visits),
    // Averaged over PAID orders, not every order placed. The previous figure
    // divided total value by all orders including unpaid ones, which understated
    // what a completed sale is actually worth.
    averageOrderMinor: Math.round(rate(summary.paidTotalMinor, summary.paidOrders)),
    repeatBuyerRate: rate(summary.repeatBuyers, summary.distinctBuyers),
  };

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Advanced insights</h1>
        <p className="page-sub">Rates use visits, checkout starts, and immutable order totals.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Checkout rate" value={`${(metrics.checkoutRate * 100).toFixed(1)}%`} />
        <MetricTile label="Order rate" value={`${(metrics.orderRate * 100).toFixed(1)}%`} />
        <MetricTile label="Average order" value={String(metrics.averageOrderMinor)} />
        <MetricTile label="Repeat buyers" value={`${(metrics.repeatBuyerRate * 100).toFixed(1)}%`} />
      </section>

      <section className="card">
        <h2 className="m-0 mb-3 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Top products</h2>
        <div className="grid gap-2">
          {(topProducts ?? []).map((product) => (
            <div className="flex items-center justify-between text-sm" key={product.product_id}>
              <span style={{ color: "var(--ink)" }}>{product.product_name}</span>
              <span className="badge badge-green">{Number(product.units_sold)} sold</span>
            </div>
          ))}
        </div>
      </section>

      <Link className="btn-secondary w-max" href="/api/exports/orders">Export orders CSV</Link>
    </main>
  );
}
