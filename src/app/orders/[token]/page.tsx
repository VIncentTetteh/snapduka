import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusPoller } from "@/components/storefront/order-status-poller";
import { Timeline, type TimelineStep } from "@/components/ui/timeline";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { buyerInitiatedWhatsApp } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "Payment not received",
  pending: "Payment confirmation pending",
  paid: "Paid",
  failed: "Payment failed",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  offline_due: "Payment due to seller",
};

const FULFILLMENT_LABEL: Record<string, string> = {
  unconfirmed: "Awaiting seller confirmation",
  confirmed: "Confirmed by seller",
  preparing: "Being prepared",
  ready_for_pickup: "Ready for pickup",
  dispatched: "On the way",
  fulfilled: "Received",
  cancelled: "Cancelled",
  returned: "Returned",
};

function fmt(minor: number, currency: string) {
  if (currency === "XOF") return `${currency} ${minor.toLocaleString("en-US")}`;
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function buildTimeline(order: {
  payment_status: string;
  fulfillment_status: string;
  shops: { display_name: string };
  created_at: string;
}): TimelineStep[] {
  const paid = order.payment_status === "paid";
  const offline = order.payment_status === "offline_due";
  const fulfillmentRank: Record<string, number> = {
    unconfirmed: 0,
    confirmed: 1,
    preparing: 1,
    ready_for_pickup: 2,
    dispatched: 2,
    fulfilled: 3,
  };
  const rank = fulfillmentRank[order.fulfillment_status] ?? 0;
  const cancelled = order.fulfillment_status === "cancelled";
  const pickup = order.fulfillment_status === "ready_for_pickup";

  const paymentStep: TimelineStep = paid
    ? { title: "Payment received via Paystack", state: "done" }
    : offline
      ? { title: "Payment due to seller", detail: "Pay on delivery or by transfer", state: "current" }
      : order.payment_status === "failed"
        ? { title: "Payment failed", detail: "Retry from your checkout link", state: "current" }
        : { title: "Payment pending", state: "current" };

  return [
    {
      title: "Order placed",
      detail: new Date(order.created_at).toLocaleString(),
      state: "done",
    },
    paymentStep,
    {
      title: `Confirmed by ${order.shops.display_name}`,
      state: cancelled ? "pending" : rank >= 1 ? "done" : "pending",
    },
    {
      title: pickup ? "Ready for pickup" : "Out for delivery",
      state: cancelled ? "pending" : rank >= 3 ? "done" : rank >= 2 ? "current" : "pending",
    },
    {
      title: "Delivered",
      state: cancelled ? "pending" : rank >= 3 ? "done" : "pending",
    },
  ];
}

export default async function TrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("*,order_lines(*),order_events(*),shops(display_name,slug),seller_accounts(contact_phone)")
    .eq("tracking_token", token)
    .maybeSingle();
  if (!order) notFound();
  const { data: shipment } = await admin
    .from("shipments")
    .select("tracking_number,tracking_url,status,provider")
    .eq("order_id", order.id)
    .maybeSingle();

  const shop = order.shops as { display_name: string; slug: string };
  const phone = order.seller_accounts?.contact_phone as string | undefined;
  const cancelled = order.fulfillment_status === "cancelled";
  const paid = order.payment_status === "paid";
  const lines = order.order_lines as {
    id: string;
    product_id: string | null;
    product_name: string;
    variant_name: string | null;
    quantity: number;
    line_total_minor: number;
  }[];
  const subtotal = lines.reduce((sum, line) => sum + line.line_total_minor, 0);

  const statusLine = [
    PAYMENT_LABEL[order.payment_status as string],
    FULFILLMENT_LABEL[order.fulfillment_status as string],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <OrderStatusPoller
        token={token}
        initial={{
          paymentStatus: order.payment_status,
          fulfillmentStatus: order.fulfillment_status,
          status: order.status,
        }}
      />
      <div className="mx-auto max-w-[640px] px-4 pb-16 pt-5">
        {/* Status card */}
        <div className="mb-4 rounded-2xl border border-line bg-white px-5 py-5.5 text-center">
          <span
            aria-hidden="true"
            className={`mb-3 inline-grid h-12 w-12 place-items-center rounded-full ${
              cancelled ? "bg-neutral-tint" : "bg-success-tint"
            }`}
          >
            {cancelled ? (
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="m5 5 8 8M13 5l-8 8" stroke="#57504A" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3.5 9.5 7 13l7.5-8" stroke="#047857" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <h1 className="mb-1.5 max-w-none font-serif text-[22px] font-medium">
            {cancelled ? "Order cancelled" : paid ? "Order confirmed" : "Order received"}
          </h1>
          <p className="mb-1 text-[13.5px] text-ink-soft">
            Order <strong className="font-bold text-ink">{order.public_reference}</strong> ·{" "}
            {shop.display_name}
          </p>
          <p className={`m-0 text-[12.5px] font-semibold ${cancelled ? "text-ink-muted" : "text-success"}`}>
            {statusLine}
          </p>
        </div>

        {query.payment === "pending" && order.payment_status !== "paid" && (
          <div
            role="status"
            className="mb-4 rounded-[10px] border border-warn-line bg-warn-tint px-3.5 py-3 text-[13px] leading-[1.5] text-warn"
          >
            Payment confirmation is pending. Do not pay twice — this page will update
            automatically once Paystack confirms.
          </div>
        )}

        {/* Progress */}
        <div className="mb-4 rounded-[14px] border border-line bg-white px-5 py-4.5">
          <h2 className="mb-3.5 text-[14px] font-bold">Progress</h2>
          <Timeline steps={buildTimeline(order)} />
          {shipment?.tracking_number ? (
            <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] text-ink-soft">
              Delivery tracking:{" "}
              {shipment.tracking_url ? (
                <a
                  href={shipment.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono font-semibold text-accent underline"
                >
                  {shipment.tracking_number}
                </a>
              ) : (
                <span className="font-mono font-semibold text-ink">{shipment.tracking_number}</span>
              )}
            </p>
          ) : null}
        </div>

        {/* Items */}
        <div className="mb-4 overflow-hidden rounded-[14px] border border-line bg-white">
          <h2 className="m-0 border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
            Your items
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
              <span>
                <span className="block text-[13px] font-semibold">{line.product_name}</span>
                <span className="block text-[11.5px] text-ink-muted">
                  {line.variant_name ? `${line.variant_name} · ` : ""}Qty {line.quantity}
                </span>
              </span>
              <span className="text-[13px] font-bold">{fmt(line.line_total_minor, order.currency)}</span>
            </div>
          ))}
          <div className="grid gap-1.5 px-4.5 py-3.5">
            <span className="flex justify-between text-[12.5px] text-ink-soft">
              <span>Subtotal</span>
              <span className="font-semibold text-ink">{fmt(subtotal, order.currency)}</span>
            </span>
            <span className="flex justify-between text-[12.5px] text-ink-soft">
              <span>Delivery</span>
              <span className="font-semibold text-ink">
                {order.delivery_minor > 0 ? fmt(order.delivery_minor, order.currency) : "Free"}
              </span>
            </span>
            <span className="flex justify-between border-t border-line-soft pt-2 text-[14px] font-bold">
              <span>{paid ? "Total paid" : "Total"}</span>
              <span>{fmt(order.total_minor, order.currency)}</span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {phone ? (
            <a
              href={buyerInitiatedWhatsApp(phone, `Hello, I need help with order ${order.public_reference}.`)}
              className="grid h-12 place-items-center rounded-[11px] bg-success text-[13.5px] font-bold text-white no-underline transition-colors hover:bg-success-deep"
            >
              Message {shop.display_name.split(" ")[0]} on WhatsApp
            </a>
          ) : null}
          <Link
            href={`/orders/${token}/support`}
            className="grid h-12 place-items-center rounded-[11px] border border-line-strong bg-white text-[13.5px] font-bold text-ink no-underline transition-colors hover:border-[#B9AC98]"
          >
            Get help with this order
          </Link>
        </div>
        <p className="mt-3.5 text-center text-[11.5px] text-ink-faint">
          This page is your receipt — bookmark it. No account needed. ·{" "}
          <Link href={`/${shop.slug}`} className="font-semibold text-ink-soft underline">
            Return to shop
          </Link>
        </p>
      </div>
    </main>
  );
}
