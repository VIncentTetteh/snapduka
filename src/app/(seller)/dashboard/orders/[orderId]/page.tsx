import { notFound } from "next/navigation";
import Link from "next/link";

import { OrderActions } from "@/components/seller/order-actions";
import { FulfillmentBadge, PaymentBadge } from "@/components/seller/status-badges";
import { InitialsAvatar, gradientForSeed } from "@/components/ui/gradient-placeholder";
import { Panel } from "@/components/ui/surface";
import { Timeline, type TimelineStep } from "@/components/ui/timeline";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

type OrderLine = {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
};

type OrderEvent = {
  id: string;
  event_type: string;
  created_at: string;
};

type BuyerSnapshot = {
  name?: string;
  email?: string;
  phone?: string;
  address?: { line1?: string; area?: string; city?: string; region?: string };
};

type FulfillmentSnapshot = {
  name?: string;
  type?: string;
  feeMinor?: number;
  instructions?: string;
};

const EVENT_LABEL: Record<string, string> = {
  order_placed: "Order placed",
  order_confirmed: "Confirmed by you",
  order_processing: "Being prepared",
  order_completed: "Order completed",
  order_cancelled: "Order cancelled",
  payment_received: "Payment received via Paystack",
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { orderId } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*,order_lines(*),order_events(*)")
    .eq("id", orderId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!order) notFound();

  const buyer = (order.buyer_snapshot ?? {}) as BuyerSnapshot;
  const fulfillment = (order.fulfillment_method_snapshot ?? {}) as FulfillmentSnapshot;
  const lines = (order.order_lines ?? []) as OrderLine[];
  const events = (order.order_events ?? []) as OrderEvent[];
  const currency = order.currency as CurrencyCode;

  const itemSubtotal = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
  const deliveryFee = fulfillment.feeMinor ?? 0;
  const addr = [buyer.address?.line1, buyer.address?.area, buyer.address?.city, buyer.address?.region]
    .filter(Boolean)
    .join(", ");

  const whatsappPhone = buyer.phone?.replace(/[^0-9]/g, "");
  const whatsappUrl = whatsappPhone
    ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`Hi ${buyer.name ?? "there"}, regarding your order #${order.public_reference} on SnapDuka.`)}`
    : null;

  // The trailing event only reads as "in progress" while the order is still
  // moving; terminal orders get a fully checked timeline.
  const orderSettled =
    ["fulfilled", "cancelled", "returned"].includes(order.fulfillment_status) ||
    ["completed", "cancelled"].includes(order.status);
  const timelineSteps: TimelineStep[] = events
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((event, index, sorted) => ({
      title: EVENT_LABEL[event.event_type] ?? event.event_type.replace(/_/g, " "),
      detail: new Date(event.created_at).toLocaleString(),
      state:
        index === sorted.length - 1 && !orderSettled
          ? ("current" as const)
          : ("done" as const),
    }));

  const TABS = [
    { label: "Overview", href: `/dashboard/orders/${order.id}`, active: true },
    { label: "Shipping", href: `/dashboard/orders/${order.id}/shipping`, active: false },
    { label: "Support", href: `/dashboard/orders/${order.id}/support`, active: false },
  ];

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      {/* A refused transition used to change nothing and say nothing, which
          reads as a broken button — most often after the order moved on in
          another tab. */}
      {actionError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {actionError}
        </div>
      ) : null}

      {/* Header */}
      <div className="mb-4">
        <Link
          href="/dashboard/orders"
          className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
        >
          ← Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="max-w-none font-serif text-[clamp(24px,3vw,30px)] font-medium tracking-[-0.01em] text-ink">
            Order #{order.public_reference}
          </h1>
          <span className="font-serif text-[22px] font-medium text-ink">
            {formatMoney(order.total_minor, currency)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PaymentBadge status={order.payment_status} />
          <FulfillmentBadge status={order.fulfillment_status} />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={`-mb-px min-h-10 border-b-2 px-3.5 pt-2 text-[13.5px] no-underline ${
              tab.active
                ? "border-accent font-bold text-ink"
                : "border-transparent font-semibold text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        {/* LEFT column */}
        <div className="grid gap-4">
          {/* Items */}
          <Panel className="overflow-hidden">
            <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
              Items ({lines.length})
            </h2>
            {lines.map((line) => (
              <div
                key={line.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3"
              >
                <span
                  aria-hidden="true"
                  className="block h-10 w-10 rounded-[10px]"
                  style={{ background: gradientForSeed(line.product_id ?? line.product_name) }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">
                    {line.product_name}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    {line.variant_name ? `${line.variant_name} · ` : ""}
                    {line.quantity} × {formatMoney(line.unit_price_minor, currency)}
                  </span>
                </span>
                <span className="text-[13.5px] font-bold text-ink">
                  {formatMoney(line.line_total_minor, currency)}
                </span>
              </div>
            ))}
            <div className="grid gap-1.5 px-4.5 py-3.5">
              <span className="flex justify-between text-[12.5px] text-ink-soft">
                <span>Subtotal</span>
                <span className="font-semibold text-ink">{formatMoney(itemSubtotal, currency)}</span>
              </span>
              <span className="flex justify-between text-[12.5px] text-ink-soft">
                <span>Delivery{fulfillment.name ? ` · ${fulfillment.name}` : ""}</span>
                <span className="font-semibold text-ink">
                  {deliveryFee > 0 ? formatMoney(deliveryFee, currency) : "Free"}
                </span>
              </span>
              <span className="flex justify-between border-t border-line-soft pt-2 text-[14px] font-bold text-ink">
                <span>Total</span>
                <span>{formatMoney(order.total_minor, currency)}</span>
              </span>
            </div>
          </Panel>

          {/* Actions */}
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Order actions</h2>
            <OrderActions order={order} />
            <Link
              href={`/dashboard/orders/${order.id}/shipping`}
              className="mt-3 inline-flex min-h-10 items-center rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
            >
              Delivery tracking →
            </Link>
          </Panel>

          {/* Fulfillment notes */}
          {(fulfillment.name ?? fulfillment.type ?? fulfillment.instructions) && (
            <Panel className="p-4.5">
              <h2 className="mb-3 text-[14px] font-bold">Fulfilment</h2>
              <dl className="grid gap-1.5 text-[13px]">
                {(fulfillment.name ?? fulfillment.type) && (
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 font-semibold text-ink-muted">Method</dt>
                    <dd className="m-0 capitalize text-ink">{fulfillment.name ?? fulfillment.type}</dd>
                  </div>
                )}
                {fulfillment.instructions && (
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 font-semibold text-ink-muted">Notes</dt>
                    <dd className="m-0 text-ink">{fulfillment.instructions}</dd>
                  </div>
                )}
              </dl>
            </Panel>
          )}
        </div>

        {/* RIGHT column */}
        <div className="grid gap-4">
          {/* Customer */}
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Customer</h2>
            <div className="flex items-center gap-3">
              <InitialsAvatar name={buyer.name ?? "?"} className="h-11 w-11 text-[14px]" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">{buyer.name ?? "—"}</p>
                {buyer.email ? (
                  <p className="truncate text-[12px] text-ink-muted">{buyer.email}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-3 grid gap-1.5 text-[13px] text-ink-soft">
              {buyer.phone ? <p className="m-0">{buyer.phone}</p> : null}
              {addr ? <p className="m-0">{addr}</p> : null}
            </div>
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 grid min-h-11 place-items-center rounded-[10px] bg-success text-[13px] font-bold text-white no-underline transition-colors hover:bg-success-deep"
              >
                Message on WhatsApp
              </a>
            ) : null}
          </Panel>

          {/* Timeline */}
          <Panel className="p-4.5">
            <h2 className="mb-3.5 text-[14px] font-bold">Timeline</h2>
            {timelineSteps.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No events recorded.</p>
            ) : (
              <Timeline steps={timelineSteps} />
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}
