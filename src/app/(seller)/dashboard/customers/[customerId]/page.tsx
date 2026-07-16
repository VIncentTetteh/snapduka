import Link from "next/link";
import { notFound } from "next/navigation";

import { FulfillmentBadge, PaymentBadge } from "@/components/seller/status-badges";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { customerId } = await params;
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id,name,email,phone,customer_consents(purpose,status,captured_at),orders(id,public_reference,total_minor,currency,payment_status,fulfillment_status,created_at)",
    )
    .eq("id", customerId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!customer) notFound();

  const orders = (customer.orders ?? [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const paidOrders = orders.filter((order) => order.payment_status === "paid");
  const currency = (orders[0]?.currency ?? "GHS") as CurrencyCode;
  const spend = paidOrders.reduce((sum, order) => sum + order.total_minor, 0);

  return (
    <main className="sd-main mx-auto max-w-[840px] px-4 pt-6 sm:px-6">
      <Link
        href="/dashboard/customers"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
      >
        ← Customers
      </Link>

      <div className="mb-5 flex items-center gap-4">
        <InitialsAvatar name={customer.name ?? "?"} className="h-14 w-14 text-[18px]" />
        <div className="min-w-0">
          <h1 className="max-w-none truncate font-serif text-[clamp(24px,3vw,30px)] font-medium tracking-[-0.01em] text-ink">
            {customer.name}
          </h1>
          <p className="text-[13.5px] text-ink-soft">
            {[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details"}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-3 gap-3.5">
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Orders</p>
          <p className="font-serif text-[22px] font-medium text-ink">{orders.length}</p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Total spend</p>
          <p className="font-serif text-[22px] font-medium text-ink">{formatMoney(spend, currency)}</p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Repeat buyer</p>
          <p className="font-serif text-[22px] font-medium text-ink">
            {paidOrders.length > 1 ? "Yes" : "No"}
          </p>
        </Panel>
      </div>

      {/* Consent */}
      <Panel className="mb-4 p-4.5">
        <h2 className="mb-3 text-[14px] font-bold">Consent</h2>
        {customer.customer_consents.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No consent records.</p>
        ) : (
          <div className="grid gap-2">
            {customer.customer_consents.map((consent) => (
              <div key={consent.purpose} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="capitalize text-ink-soft">{consent.purpose.replace(/_/g, " ")}</span>
                <Badge tone={consent.status === "granted" ? "success" : "neutral"}>
                  {consent.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Order history */}
      <Panel className="overflow-hidden">
        <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Orders</h2>
        {orders.length === 0 ? (
          <p className="px-4.5 py-6 text-center text-[13px] text-ink-soft">No orders yet.</p>
        ) : (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/dashboard/orders/${order.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
            >
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">
                  #{order.public_reference}
                </span>
                <span className="block text-[12px] text-ink-muted">
                  {new Date(order.created_at).toLocaleDateString()}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-[13.5px] font-bold text-ink">
                  {formatMoney(order.total_minor, order.currency as CurrencyCode)}
                </span>
                <PaymentBadge status={order.payment_status} />
                <FulfillmentBadge status={order.fulfillment_status} />
              </span>
            </Link>
          ))
        )}
      </Panel>
    </main>
  );
}
