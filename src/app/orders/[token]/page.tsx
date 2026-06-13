import Link from "next/link";
import { notFound } from "next/navigation";

import { buyerInitiatedWhatsApp } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function TrackingPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders")
    .select("*,order_lines(*),order_events(*),shops(display_name,slug),seller_accounts(contact_phone)")
    .eq("tracking_token", token).maybeSingle();
  if (!order) notFound();
  const events = order.order_events.filter((event: { buyer_visible: boolean }) => event.buyer_visible);
  const phone = order.seller_accounts?.contact_phone;
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-2xl gap-4 bg-stone-50 px-3 py-5 pb-16">
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">Order receipt</p><h1 className="m-0 text-4xl font-black">{order.public_reference}</h1><p>From {order.shops.display_name}</p></header>
      {query.payment === "pending" && order.payment_status !== "paid" ? <p className="rounded-xl border border-amber-600 bg-amber-50 p-3" role="status">Payment confirmation is pending. Do not pay twice; this page will reflect signed Paystack confirmation.</p> : null}
      <section className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-white p-3"><strong>Payment</strong><p>{order.payment_status}</p></div><div className="rounded-xl bg-white p-3"><strong>Fulfillment</strong><p>{order.fulfillment_status}</p></div></section>
      <section className="rounded-2xl border border-stone-300 bg-white p-4"><h2>Items</h2>{order.order_lines.map((line: { id:string; product_name:string; variant_name:string|null; quantity:number; line_total_minor:number }) => <p key={line.id}>{line.quantity} × {line.product_name}{line.variant_name ? ` (${line.variant_name})` : ""} — {order.currency} {(line.line_total_minor/100).toFixed(2)}</p>)}<p>Delivery: {order.currency} {(order.delivery_minor/100).toFixed(2)}</p><strong>Total: {order.currency} {(order.total_minor/100).toFixed(2)}</strong></section>
      <section className="rounded-2xl border border-stone-300 bg-white p-4"><h2>Receiving your order</h2><p><strong>{String(order.fulfillment_method_snapshot.name)}</strong></p><p>{String(order.fulfillment_method_snapshot.instructions)}</p></section>
      <section><h2>Timeline</h2>{events.map((event: { id:string; event_type:string; created_at:string }) => <p key={event.id}>{new Date(event.created_at).toLocaleString()} · {event.event_type.replaceAll("_"," ")}</p>)}</section>
      <div className="flex flex-wrap gap-2">{phone ? <a className="min-h-11 rounded-xl bg-emerald-900 px-4 py-3 font-bold text-white" href={buyerInitiatedWhatsApp(phone, `Hello, I need help with order ${order.public_reference}.`)}>Message seller on WhatsApp</a> : null}<Link className="min-h-11 rounded-xl border border-stone-400 px-4 py-3 font-bold" href={`/orders/${token}/support`}>Get order support</Link><Link className="min-h-11 rounded-xl border border-stone-400 px-4 py-3 font-bold" href={`/${order.shops.slug}`}>Return to shop</Link></div>
    </main>
  );
}
