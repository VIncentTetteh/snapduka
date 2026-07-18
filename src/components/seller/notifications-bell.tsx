import Link from "next/link";

import { markNotificationsReadAction } from "@/app/(seller)/dashboard/actions";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

const EVENT_LABEL: Record<string, string> = {
  order_placed: "New order",
  payment_succeeded: "Payment received",
  order_confirmed: "Order confirmed",
  order_cancelled: "Order cancelled",
  shipment_booked: "Shipment booked",
  shipment_in_transit: "Delivery in transit",
  shipment_delivered: "Order delivered",
};

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Seller in-app notification inbox: a native disclosure (CSP-safe, no JS)
 * listing the latest alerts with an unread badge and mark-all-read.
 */
export async function NotificationsBell() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  // RLS already scopes reads to the owning seller; the explicit filter is
  // defense-in-depth (operators bypass that policy via is_operator()).
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, order_id, payload, read_at, created_at")
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(8);

  const items = notifications ?? [];
  const unread = items.filter((item) => !item.read_at).length;

  return (
    <details className="group relative">
      <summary
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative grid h-10 w-10 cursor-pointer list-none place-items-center rounded-[10px] border border-line-input bg-white text-ink-soft transition-colors hover:bg-line-soft [&::-webkit-details-marker]:hidden"
      >
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2.5a5 5 0 0 0-5 5v3l-1.5 3h13L15 10.5v-3a5 5 0 0 0-5-5Zm-1.8 11.8a1.8 1.8 0 0 0 3.6 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </summary>

      <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(340px,86vw)] overflow-hidden rounded-2xl border border-line bg-white shadow-float">
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <p className="text-[13px] font-bold text-ink">Notifications</p>
          {unread > 0 ? (
            <form action={markNotificationsReadAction}>
              <button
                type="submit"
                className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-bold text-accent hover:text-accent-deep"
              >
                Mark all read
              </button>
            </form>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-ink-soft">
            No notifications yet — new orders and payments show up here.
          </p>
        ) : (
          items.map((item) => {
            const payload = item.payload as { reference?: string; status?: string };
            const label =
              EVENT_LABEL[payload.status ?? ""] ??
              (payload.status ?? "Update").replace(/_/g, " ");
            return (
              <Link
                key={item.id}
                href={item.order_id ? `/dashboard/orders/${item.order_id}` : "/dashboard/orders"}
                className="flex items-start gap-2.5 border-b border-[#F7F2EA] px-4 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 flex-none rounded-full ${item.read_at ? "bg-line" : "bg-accent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">
                    {label}
                    {payload.reference ? (
                      <span className="font-normal text-ink-muted"> · #{payload.reference}</span>
                    ) : null}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    {timeAgo(item.created_at)}
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </div>
    </details>
  );
}
