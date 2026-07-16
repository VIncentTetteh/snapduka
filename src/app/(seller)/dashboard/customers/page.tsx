import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export default async function CustomersPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id,name,email,phone,orders(total_minor,currency,created_at,payment_status)")
    .eq("seller_account_id", actor.sellerAccountId)
    .order("updated_at", { ascending: false })
    .limit(200);

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Customers"
        sub="Seller-scoped purchase history and consent records."
      />

      {!customers?.length ? (
        <EmptyState
          title="No customers yet"
          body="Customers appear here after their first order — with purchase history and consent records."
        />
      ) : (
        <Panel className="overflow-hidden">
          {customers.map((customer) => {
            const orders = customer.orders ?? [];
            const paidOrders = orders.filter((order) => order.payment_status === "paid");
            const spend = paidOrders.reduce((sum, order) => sum + order.total_minor, 0);
            const currency = (orders[0]?.currency ?? "GHS") as CurrencyCode;
            const lastOrder = orders
              .map((order) => order.created_at)
              .sort()
              .at(-1);
            const isRepeat = paidOrders.length > 1;

            return (
              <Link
                key={customer.id}
                href={`/dashboard/customers/${customer.id}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3.5 no-underline transition-colors last:border-b-0 hover:bg-paper"
              >
                <InitialsAvatar name={customer.name ?? "?"} className="h-10 w-10 text-[13px]" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">
                      {customer.name}
                    </span>
                    {isRepeat ? <Badge tone="accent">Repeat</Badge> : null}
                  </span>
                  <span className="block truncate text-[12px] text-ink-muted">
                    {customer.email ?? customer.phone ?? "—"} · {orders.length}{" "}
                    {orders.length === 1 ? "order" : "orders"}
                    {lastOrder ? ` · last ${new Date(lastOrder).toLocaleDateString()}` : ""}
                  </span>
                </span>
                <span className="text-[14px] font-bold text-ink">
                  {formatMoney(spend, currency)}
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </main>
  );
}
