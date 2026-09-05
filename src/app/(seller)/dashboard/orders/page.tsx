import Link from "next/link";

import { FulfillmentBadge, PaymentBadge } from "@/components/seller/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills } from "@/components/ui/filter-pills";
import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import {
  ORDER_RANGES,
  buildOrderSearchFilter,
  ilikePattern,
  isOrderRange,
  normalizeSearchTerm,
  rangeCutoff,
} from "@/lib/orders/search";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Paid", value: "paid" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
  { label: "Unfulfilled", value: "unfulfilled" },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Orders whose line items matched, resolved separately because PostgREST cannot
 * OR across an embedded resource and its parent. Capped so the resulting
 * `id.in.(…)` list stays well inside the URL length a GET can carry — a product
 * with more matches than this contributes its most recent orders.
 */
const PRODUCT_MATCH_LIMIT = 100;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; range?: string; error?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const filters = await searchParams;
  const supabase = await createClient();
  const term = normalizeSearchTerm(filters.q);

  // Product names live on order_lines, which RLS scopes through the parent
  // order, so this is already limited to this seller's orders.
  let productOrderIds: string[] = [];
  if (term) {
    const { data: lines } = await supabase
      .from("order_lines")
      .select("order_id,created_at")
      .ilike("product_name", ilikePattern(term))
      .order("created_at", { ascending: false })
      .limit(PRODUCT_MATCH_LIMIT);
    productOrderIds = [...new Set((lines ?? []).map((line) => line.order_id))];
  }

  let query = supabase
    .from("orders")
    .select(
      "id,public_reference,payment_status,fulfillment_status,total_minor,currency,buyer_snapshot,created_at,order_lines(id)",
    )
    .eq("seller_account_id", actor.sellerAccountId)
    .order("created_at", { ascending: false })
    .limit(100);

  switch (filters.filter) {
    case "paid":
      query = query.eq("payment_status", "paid");
      break;
    case "pending":
      query = query.in("payment_status", ["unpaid", "pending", "offline_due"]);
      break;
    case "failed":
      query = query.eq("payment_status", "failed");
      break;
    case "unfulfilled":
      query = query.in("fulfillment_status", ["unconfirmed", "confirmed", "preparing"]);
      break;
  }
  // Was `ilike` on public_reference alone: searching a customer's name or a
  // product returned nothing, which reads exactly like having no orders.
  const searchFilter = buildOrderSearchFilter(term, productOrderIds);
  if (searchFilter) query = query.or(searchFilter);
  const cutoff = rangeCutoff(filters.range, new Date());
  if (cutoff) query = query.gte("created_at", cutoff);

  const { data: orders } = await query;
  const isFiltered = Boolean(term || filters.filter || cutoff);

  const hrefWith = (overrides: { filter?: string; range?: string }) => {
    const qs = new URLSearchParams();
    const filter = overrides.filter ?? filters.filter;
    const range = overrides.range ?? filters.range;
    if (filter) qs.set("filter", filter);
    if (term) qs.set("q", term);
    if (isOrderRange(range)) qs.set("range", range);
    const suffix = qs.toString();
    return `/dashboard/orders${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader title="Orders" sub="Every order, payment and fulfilment state in one place." />

      {/* A bulk update that refused some orders used to report nothing at all. */}
      {filters.error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {filters.error}
        </div>
      ) : null}

      <div className="mb-4">
        <FilterPills
          pills={FILTERS.map((f) => ({
            label: f.label,
            href: hrefWith({ filter: f.value }),
            active: (filters.filter ?? "") === f.value,
          }))}
        />
      </div>

      {/*
        Keyed on the applied state so React remounts the form on navigation.
        `defaultValue` only applies on mount, and client-side nav reuses these
        DOM nodes: change the date, click a status pill instead of Search, and
        the select kept claiming "Last 24 hours" over a list that was not date
        filtered at all. The controls must describe the results being shown.
      */}
      <form key={hrefWith({})} className="mb-4 flex flex-wrap gap-2">
        {filters.filter ? <input name="filter" type="hidden" value={filters.filter} /> : null}
        <input
          defaultValue={term}
          name="q"
          placeholder="Search name, phone, product or #reference…"
          aria-label="Search orders"
          className="h-11 min-w-0 flex-1 basis-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)] sm:basis-auto"
        />
        <select
          defaultValue={isOrderRange(filters.range) ? filters.range : ""}
          name="range"
          aria-label="Limit to orders from the last"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3 text-[14px] text-ink outline-none focus:border-accent sm:flex-none"
        >
          <option value="">Any time</option>
          {Object.entries(ORDER_RANGES).map(([value, range]) => (
            <option key={value} value={value}>
              Last {range.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-11 cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-ink-2"
        >
          Search
        </button>
      </form>

      {!orders?.length ? (
        // A filtered miss is not an empty shop. Telling a seller with 200 orders
        // "No orders yet" reads as data loss.
        <EmptyState
          title={isFiltered ? "No matching orders" : "No orders yet"}
          body={
            isFiltered
              ? "Try a different search, filter or date range."
              : "Share your storefront to start receiving orders."
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          {orders.map((order) => {
            const buyer = order.buyer_snapshot as { name?: string } | null;
            const name = buyer?.name ?? "Customer";
            const itemCount = order.order_lines?.length ?? 0;
            return (
              <Link
                key={order.id}
                href={`/dashboard/orders/${order.id}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3.5 no-underline transition-colors last:border-b-0 hover:bg-paper"
              >
                <InitialsAvatar name={name} className="h-10 w-10 text-[13px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{name}</span>
                  <span className="block text-[12px] text-ink-muted">
                    #{order.public_reference} · {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
                    {timeAgo(order.created_at)}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <span className="text-[14px] font-bold text-ink">
                    {formatMoney(order.total_minor, order.currency as CurrencyCode)}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    <PaymentBadge status={order.payment_status} />
                    <FulfillmentBadge status={order.fulfillment_status} />
                  </span>
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </main>
  );
}
