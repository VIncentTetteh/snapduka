import Link from "next/link";

import { MetricTile } from "@/components/ui/metric-tile";
import { advancedCommerceMetrics } from "@/lib/analytics/advanced";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { fetchEventCounts } from "@/lib/analytics/event-counts";

export default async function InsightsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [eventCounts, { data: orders }, { data: lines }] = await Promise.all([
    fetchEventCounts(actor.sellerAccountId),
    supabase.from("orders").select("customer_id,total_minor").eq("seller_account_id", actor.sellerAccountId),
    supabase.from("order_lines").select("product_name,quantity,line_total_minor,orders!inner(seller_account_id)").eq("orders.seller_account_id", actor.sellerAccountId),
  ]);
  const metrics = advancedCommerceMetrics({
    visits: eventCounts.visit,
    checkouts: eventCounts.checkout_start,
    orders: (orders ?? []).map((o) => ({ customerId: o.customer_id, totalMinor: o.total_minor })),
  });
  const top = new Map<string, number>();
  for (const line of lines ?? []) top.set(line.product_name, (top.get(line.product_name) ?? 0) + line.quantity);

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
          {[...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => (
            <div className="flex items-center justify-between text-sm" key={name}>
              <span style={{ color: "var(--ink)" }}>{name}</span>
              <span className="badge badge-green">{count} sold</span>
            </div>
          ))}
        </div>
      </section>

      <Link className="btn-secondary w-max" href="/api/exports/orders">Export orders CSV</Link>
    </main>
  );
}
