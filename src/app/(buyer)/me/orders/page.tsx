import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listBuyerOrders } from "@/lib/buyer/account";
import { formatOrderTotal, fulfillmentBadge, paymentLabel } from "@/lib/buyer/order-labels";
import { getBuyerSession } from "@/lib/buyer/session";

import { CARD, PageTitle, SignInPrompt, first, type SearchParams } from "../shared";

/**
 * Orders across every shop, newest first. Each row links to the existing
 * tracking page (/orders/[token]) rather than re-rendering order detail here:
 * that page is the one buyers already receive by SMS, and it stays the single
 * place order detail is built.
 *
 * Rows come from buyer_order_history(), which names its columns explicitly —
 * nothing a seller keeps on an order reaches this page by accident.
 */
export default async function BuyerOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getBuyerSession();
  if (session.state !== "buyer") {
    return (
      <>
        <PageTitle title="Your orders" />
        <SignInPrompt />
      </>
    );
  }

  const before = first((await searchParams).before);
  const validBefore = before && !Number.isNaN(Date.parse(before)) ? before : null;
  const page = await listBuyerOrders(session.client, validBefore);

  return (
    <>
      <PageTitle title="Your orders" sub="Orders placed with your phone number at any SnapDuka shop." />

      {!session.buyer.consented ? (
        <div className={CARD}>
          <p className="text-[14px] leading-[1.6] text-ink-soft">
            Your orders are not linked yet.{" "}
            <Link href="/me" className="font-semibold text-accent underline">
              Agree to link them
            </Link>{" "}
            to see orders from every shop here.
          </p>
        </div>
      ) : !page ? (
        <div role="alert" className={CARD}>
          We could not load your orders. Please refresh.
        </div>
      ) : page.rows.length === 0 ? (
        <EmptyState
          title={validBefore ? "No older orders" : "No orders yet"}
          body="Orders you place with this phone number will appear here, from every shop."
        />
      ) : (
        <>
          <ul className="grid gap-3">
            {page.rows.map((order) => {
              const badge = fulfillmentBadge(order.fulfillment_status);
              return (
                <li key={order.order_id}>
                  <Link
                    href={`/orders/${order.tracking_token}`}
                    className="grid gap-1.5 rounded-[14px] border border-line bg-white p-4 hover:border-line-strong"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14.5px] font-bold text-ink">{order.shop_name}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </span>
                    <span className="text-[13px] text-ink-soft">
                      {order.public_reference} · {new Date(order.created_at).toLocaleDateString("en-GH", { dateStyle: "medium" })} ·{" "}
                      {order.item_count} item{order.item_count === 1 ? "" : "s"}
                    </span>
                    <span className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink-muted">{paymentLabel(order.payment_status)}</span>
                      <span className="font-bold text-ink">{formatOrderTotal(order.total_minor, order.currency)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {page.nextBefore ? (
            <div className="mt-4">
              <Link
                href={`/me/orders?${new URLSearchParams({ before: page.nextBefore })}`}
                className="font-semibold text-accent underline"
              >
                Older orders
              </Link>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
