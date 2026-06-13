import { MetricCard } from "@/components/seller/metric-card";
import { resolveServerActor } from "@/lib/auth/actor";
import { calculateCommerceMetrics } from "@/lib/analytics/metrics";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function GrowthPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: events }, { data: orders }] = await Promise.all([
    supabase.from("analytics_events").select("event_type").eq("seller_account_id", actor.sellerAccountId),
    supabase.from("orders").select("status,payment_status,fulfillment_status").eq("seller_account_id", actor.sellerAccountId),
  ]);
  const metrics = calculateCommerceMetrics({
    visits: events?.filter((event) => event.event_type === "visit").length ?? 0,
    productViews: events?.filter((event) => event.event_type === "product_view").length ?? 0,
    checkoutStarts: events?.filter((event) => event.event_type === "checkout_start").length ?? 0,
    orders: (orders ?? []).map((order) => ({ status: order.status, paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status })),
  });
  const tools=[["/dashboard/growth/promotions","Promotions"],["/dashboard/growth/campaigns","Campaign links"],["/dashboard/growth/segments","Customer segments"],["/dashboard/growth/broadcasts","Broadcasts"],["/dashboard/growth/insights","Advanced insights"],["/dashboard/customers","Customers"],["/dashboard/settings/branding","Branding"],["/dashboard/settings/billing","Billing"],["/dashboard/settings/team","Team"],["/dashboard/settings/developers","Developer tools"],["/dashboard/settings/discovery","Discovery"],["/dashboard/settings/notifications","Notifications"]] as const;
  return <main className="mx-auto grid w-full max-w-5xl gap-4 px-3 py-5 pb-24"><header><p className="font-bold uppercase tracking-wide text-emerald-900">All time</p><h1 className="m-0 text-4xl font-black">Growth</h1><p>Completed orders are the north-star metric. Rates use authoritative commerce states.</p></header><section className="grid grid-cols-2 gap-3"><MetricCard label="Visits" value={String(metrics.visits)} /><MetricCard label="Product views" value={String(metrics.productViews)} /><MetricCard label="Checkout starts" value={String(metrics.checkoutStarts)} /><MetricCard label="Orders placed" value={String(metrics.placedOrders)} /><MetricCard label="Completed orders" value={String(metrics.completedOrders)} /><MetricCard label="Conversion" value={`${(metrics.conversionRate*100).toFixed(1)}%`} /><MetricCard label="Payment success" value={`${(metrics.paymentSuccessRate*100).toFixed(1)}%`} /><MetricCard label="Fulfillment completion" value={`${(metrics.fulfillmentCompletionRate*100).toFixed(1)}%`} /></section><section className="grid grid-cols-2 gap-2 sm:grid-cols-3">{tools.map(([href,label])=><Link className="grid min-h-16 place-items-center rounded-2xl border bg-white p-3 text-center font-bold no-underline" href={href} key={href}>{label}</Link>)}</section></main>;
}
