import Link from "next/link";

import { FulfillmentBadge, PaymentBadge } from "@/components/seller/status-badges";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { MetricTile } from "@/components/ui/metric-tile";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function DashboardPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();

  const since30d = isoDaysAgo(30);
  const [
    { data: shop },
    { data: recentOrders },
    { data: paidOrders },
    { count: unfulfilledCount },
    { count: customerCount },
    { count: visitCount },
    { data: lowStock },
    { count: productCount },
  ] = await Promise.all([
    supabase
      .from("shops")
      .select("id,slug,display_name,status,currency")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id,public_reference,created_at,payment_status,fulfillment_status,buyer_snapshot,total_minor,currency")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("orders")
      .select("total_minor,currency,customer_id")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("payment_status", "paid")
      .gte("created_at", since30d),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .in("fulfillment_status", ["unconfirmed", "confirmed", "preparing"]),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("event_type", "visit")
      .gte("created_at", since30d),
    supabase
      .from("products")
      .select("id,name,stock_quantity,reserved_quantity")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("inventory_policy", "track")
      .eq("status", "active")
      .order("stock_quantity", { ascending: true })
      .limit(4),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .neq("status", "archived"),
  ]);

  const currency = (shop?.currency ?? "GHS") as CurrencyCode;
  const revenue30d = paidOrders?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0;
  const paidCount = paidOrders?.length ?? 0;
  const visits = visitCount ?? 0;
  const conversion = visits > 0 ? ((paidCount / visits) * 100).toFixed(1) : null;
  const repeatBuyers = paidOrders
    ? Object.values(
        paidOrders.reduce<Record<string, number>>((acc, order) => {
          if (order.customer_id) acc[order.customer_id] = (acc[order.customer_id] ?? 0) + 1;
          return acc;
        }, {}),
      ).filter((count) => count > 1).length
    : 0;
  const lowStockItems = (lowStock ?? []).filter(
    (product) => (product.stock_quantity ?? 0) - (product.reserved_quantity ?? 0) <= 4,
  );
  const isNewSeller = (recentOrders?.length ?? 0) === 0 && (productCount ?? 0) === 0;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Dashboard"
        sub={shop ? `${shop.display_name} · last 30 days` : "Your shop at a glance"}
        actions={
          shop && shop.status === "published" ? (
            <ButtonLink href={`/${shop.slug}`} variant="secondary" size="sm">
              View storefront ↗
            </ButtonLink>
          ) : undefined
        }
      />

      {isNewSeller ? (
        <EmptyState
          title="Welcome to your shop"
          body="Add your first product and share your store link — your orders, payments and customers will appear here."
          action={
            <div className="flex flex-wrap justify-center gap-2.5">
              <ButtonLink href="/dashboard/products" size="sm">
                Add a product
              </ButtonLink>
              <ButtonLink href="/dashboard/share" variant="secondary" size="sm">
                Share your storefront
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          {/* Metric tiles */}
          <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <MetricTile
              label="Revenue · 30 days"
              value={formatMoney(revenue30d, currency)}
              sub={`${paidCount} paid ${paidCount === 1 ? "order" : "orders"}`}
              subTone="success"
            />
            <MetricTile
              label="Orders · 30 days"
              value={String(paidCount)}
              sub={`${unfulfilledCount ?? 0} awaiting fulfilment`}
              subTone={unfulfilledCount ? "warn" : "muted"}
            />
            <MetricTile
              label="Conversion"
              value={conversion ? `${conversion}%` : "—"}
              sub={visits > 0 ? `of ${visits.toLocaleString()} store visits` : "No visits yet"}
            />
            <MetricTile
              label="Customers"
              value={String(customerCount ?? 0)}
              sub={`${repeatBuyers} repeat ${repeatBuyers === 1 ? "buyer" : "buyers"}`}
            />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
            {/* Recent orders */}
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line-soft px-4.5 py-3.5">
                <h2 className="text-[14px] font-bold">Recent orders</h2>
                <Link href="/dashboard/orders" className="text-[12.5px] font-bold text-accent no-underline hover:text-accent-deep">
                  View all →
                </Link>
              </div>
              {(recentOrders ?? []).length === 0 ? (
                <p className="px-4.5 py-8 text-center text-[13.5px] text-ink-soft">
                  No orders yet. Share your storefront to get your first order.
                </p>
              ) : (
                (recentOrders ?? []).map((order) => {
                  const buyer = order.buyer_snapshot as { name?: string } | null;
                  return (
                    <Link
                      key={order.id}
                      href={`/dashboard/orders/${order.id}`}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
                    >
                      <span
                        aria-hidden="true"
                        className="block h-9 w-9 rounded-[9px]"
                        style={{ background: gradientForSeed(order.id) }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">
                          {buyer?.name ?? "Customer"} · #{order.public_reference}
                        </span>
                        <span className="block text-[12px] text-ink-muted">
                          {formatMoney(order.total_minor, order.currency as CurrencyCode)} ·{" "}
                          {new Date(order.created_at).toLocaleDateString()}
                        </span>
                      </span>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        <PaymentBadge status={order.payment_status} />
                        <FulfillmentBadge status={order.fulfillment_status} />
                      </span>
                    </Link>
                  );
                })
              )}
            </Panel>

            <div className="grid gap-4">
              {/* Low stock */}
              <Panel className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line-soft px-4.5 py-3.5">
                  <h2 className="text-[14px] font-bold">Low stock</h2>
                  {lowStockItems.length > 0 ? (
                    <span className="rounded-full bg-warn-tint px-2.5 py-0.5 text-[11.5px] font-bold text-warn">
                      {lowStockItems.length}
                    </span>
                  ) : null}
                </div>
                {lowStockItems.length === 0 ? (
                  <p className="px-4.5 py-6 text-center text-[13px] text-ink-soft">
                    Stock levels look healthy.
                  </p>
                ) : (
                  lowStockItems.map((product) => {
                    const available = (product.stock_quantity ?? 0) - (product.reserved_quantity ?? 0);
                    return (
                      <Link
                        key={product.id}
                        href={`/dashboard/products/${product.id}`}
                        className="flex items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
                      >
                        <span
                          aria-hidden="true"
                          className="block h-9 w-9 rounded-[9px]"
                          style={{ background: gradientForSeed(product.id) }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">
                            {product.name}
                          </span>
                          <span className={`block text-[12px] font-semibold ${available <= 0 ? "text-danger" : "text-warn"}`}>
                            {available <= 0 ? "Out of stock" : `Only ${available} left`}
                          </span>
                        </span>
                      </Link>
                    );
                  })
                )}
              </Panel>

              {/* Shortcuts */}
              <Panel className="p-4.5">
                <h2 className="mb-3 text-[14px] font-bold">Shortcuts</h2>
                <div className="grid gap-2">
                  <Link href="/dashboard/products" className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]">
                    Add a product
                  </Link>
                  <Link href="/dashboard/share" className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]">
                    Share your storefront
                  </Link>
                  <Link href="/dashboard/payouts" className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]">
                    Check your balance
                  </Link>
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
