import Link from "next/link";
import { notFound } from "next/navigation";

import { ShippingBookingForm } from "@/components/seller/shipping-booking-form";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export default async function ShippingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { orderId } = await params;
  const supabase = await createClient();
  const [{ data: order }, { data: shipment }] = await Promise.all([
    supabase.from("orders").select("public_reference,currency,delivery_minor").eq("id", orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle(),
    supabase.from("shipments").select("tracking_number,tracking_url,label_url,status,provider").eq("order_id", orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle(),
  ]);
  if (!order) notFound();
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-5 px-3 py-5 pb-24">
      <header><Link className="btn-secondary mb-3 w-max" href={`/dashboard/orders/${orderId}`}>← Order</Link><p className="page-eyebrow m-0">Order {order.public_reference}</p><h1 className="page-title mt-1">Delivery tracking</h1><p className="page-sub">Book a rider yourself (Bolt, Yango or your own dispatch) and record the tracking details — the buyer&apos;s order page updates automatically.</p></header>
      {shipment ? <article className="card"><div className="flex items-start justify-between gap-3"><div><p className="page-eyebrow m-0">{shipment.provider}</p><h2 className="m-0 mt-1 text-xl font-extrabold">{shipment.tracking_number}</h2></div><span className="badge badge-blue capitalize">{shipment.status.replaceAll("_", " ")}</span></div>{shipment.tracking_url ? <a className="btn-primary mt-4 w-max" href={shipment.tracking_url} rel="noreferrer" target="_blank">Open tracking ↗</a> : null}</article> : <ShippingBookingForm amountMinor={order.delivery_minor} orderId={orderId} />}
    </main>
  );
}
