import { notFound } from "next/navigation";

import { OrderActions } from "@/components/seller/order-actions";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { orderId } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("*,order_lines(*),order_events(*)").eq("id", orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!order) notFound();
  return <main className="mx-auto grid w-full max-w-3xl gap-4 px-3 py-5 pb-24"><header><p className="font-bold uppercase tracking-wide text-emerald-900">{order.public_reference}</p><h1 className="m-0 text-4xl font-black">{String(order.buyer_snapshot.name)}</h1><p>{order.status} · {order.payment_status} · {order.fulfillment_status}</p></header><OrderActions order={order} /><section className="rounded-2xl border border-stone-300 bg-white p-4"><h2>Items</h2>{order.order_lines.map((line: { id:string; product_name:string; variant_name:string|null; quantity:number; line_total_minor:number }) => <p key={line.id}>{line.quantity} × {line.product_name}{line.variant_name ? ` (${line.variant_name})` : ""} — {order.currency} {(line.line_total_minor/100).toFixed(2)}</p>)}<strong>Total: {order.currency} {(order.total_minor/100).toFixed(2)}</strong></section><section className="rounded-2xl border border-stone-300 bg-white p-4"><h2>Buyer and fulfillment</h2><pre className="whitespace-pre-wrap font-sans text-sm">{JSON.stringify(order.buyer_snapshot,null,2)}</pre><pre className="whitespace-pre-wrap font-sans text-sm">{JSON.stringify(order.fulfillment_method_snapshot,null,2)}</pre></section><section><h2>Timeline</h2>{order.order_events.map((event: { id:string; event_type:string; created_at:string }) => <p key={event.id}>{new Date(event.created_at).toLocaleString()} · {event.event_type}</p>)}</section></main>;
}
