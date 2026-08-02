import Link from "next/link";
import { notFound } from "next/navigation";

import { ShippingBookingForm } from "@/components/seller/shipping-booking-form";
import { resolveServerActor } from "@/lib/auth/actor";
import { isSafeHttpUrl } from "@/lib/catalog/video";
import { courierLabel, type CourierKey } from "@/lib/couriers/catalogue";
import { createClient } from "@/lib/supabase/server";

export default async function ShippingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { orderId } = await params;
  const supabase = await createClient();
  const [{ data: order }, { data: shipment }] = await Promise.all([
    supabase
      .from("orders")
      .select("public_reference,currency,delivery_minor")
      .eq("id", orderId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("shipments")
      .select("tracking_number,tracking_url,status,provider,provider_name")
      .eq("order_id", orderId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
  ]);
  if (!order) notFound();

  const courier = shipment
    ? courierLabel(shipment.provider as CourierKey, shipment.provider_name)
    : null;

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-5 px-3 py-5 pb-24">
      <header>
        <Link className="btn-secondary mb-3 w-max" href={`/dashboard/orders/${orderId}`}>
          ← Order
        </Link>
        <p className="page-eyebrow m-0">Order {order.public_reference}</p>
        <h1 className="page-title mt-1">Delivery</h1>
        <p className="page-sub">
          Arrange delivery however you like — Bolt, Yango, a courier, or your own rider — then
          record it here so your buyer knows who is bringing their order.
        </p>
      </header>

      {shipment ? (
        <article className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="page-eyebrow m-0">{courier}</p>
              <h2 className="m-0 mt-1 text-xl font-extrabold">{shipment.tracking_number}</h2>
            </div>
            <span className="badge badge-blue capitalize">
              {shipment.status.replaceAll("_", " ")}
            </span>
          </div>
          {shipment.tracking_url && isSafeHttpUrl(shipment.tracking_url) ? (
            <a
              className="btn-primary mt-4 w-max"
              href={shipment.tracking_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open tracking ↗
            </a>
          ) : null}
        </article>
      ) : null}

      {/* The form stays available after booking. It used to disappear, so a
          mistyped tracking number or the wrong courier was permanent — and the
          buyer kept seeing it. The route upserts on order_id. */}
      <ShippingBookingForm
        country={actor.country}
        existing={
          shipment
            ? {
                provider: shipment.provider as CourierKey,
                providerName: shipment.provider_name,
                trackingNumber: shipment.tracking_number,
                trackingUrl: shipment.tracking_url,
              }
            : null
        }
        orderId={orderId}
      />
    </main>
  );
}
