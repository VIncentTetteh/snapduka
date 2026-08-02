import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isSafeHttpUrl } from "@/lib/catalog/video";
import { courierLabel, isCourierKey, requiresCustomName } from "@/lib/couriers/catalogue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    orderId: z.uuid(),
    // Was z.literal("manual"), which is why every shipment ever recorded said
    // "manual" and the buyer could not be told who was delivering.
    provider: z.string().trim().refine(isCourierKey, "Unknown courier."),
    // Only used for 'other'. Bounded because it is rendered to the buyer.
    providerName: z.string().trim().min(2).max(60).optional(),
    trackingNumber: z.string().trim().min(2).max(100).optional(),
    trackingUrl: z.url().refine(isSafeHttpUrl, "Tracking URL must be http(s).").optional(),
  })
  .refine((value) => !requiresCustomName(value.provider as never) || Boolean(value.providerName), {
    message: "Name the courier.",
    path: ["providerName"],
  });

export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "orders.manage")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the tracking details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id,fulfillment_status")
    .eq("id", parsed.data.orderId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const provider = parsed.data.provider as Parameters<typeof courierLabel>[0];
  // Resolved here, not in the browser: a seller must not be able to label a
  // Bolt delivery as something else on the buyer's receipt.
  const providerName = courierLabel(provider, parsed.data.providerName);
  const trackingNumber =
    parsed.data.trackingNumber ?? `SD-${parsed.data.orderId.slice(0, 8).toUpperCase()}`;

  // Seller-arranged delivery involves no provider API — the seller has already
  // booked the rider themselves and is recording what they arranged. The old
  // courierAdapter round-trip existed only to echo these same values back.
  const { data, error } = await supabase
    .from("shipments")
    .upsert(
      {
        order_id: parsed.data.orderId,
        seller_account_id: actor.sellerAccountId,
        provider,
        provider_name: providerName,
        tracking_number: trackingNumber,
        tracking_url: parsed.data.trackingUrl ?? null,
        status: "booked",
      },
      { onConflict: "order_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Booking could not be saved." }, { status: 500 });

  // A booked shipment means the order is on its way — advance the buyer
  // timeline unless fulfilment is already past dispatch.
  if (["unconfirmed", "confirmed", "preparing"].includes(order.fulfillment_status)) {
    // The admin client, deliberately. `orders` and `order_events` have SELECT
    // policies only — there is no UPDATE policy on orders and no INSERT policy
    // on order_events for `authenticated`. This route used the RLS client, so
    // both writes silently affected zero rows and neither error was checked:
    // booking a delivery never advanced the buyer's timeline and never recorded
    // a shipment_booked event. Ownership is enforced by the seller_account_id
    // filter, exactly as updateOrderAction does.
    const admin = createAdminClient();
    const { error: statusError } = await admin
      .from("orders")
      .update({ fulfillment_status: "dispatched" })
      .eq("id", order.id)
      .eq("seller_account_id", actor.sellerAccountId);
    if (statusError) {
      console.error("[couriers/book] could not advance fulfilment", statusError.message);
    }
    const { error: eventError } = await admin.from("order_events").insert({
      order_id: order.id,
      seller_account_id: actor.sellerAccountId,
      event_type: "shipment_booked",
      actor_type: "seller",
      buyer_visible: true,
      data: { trackingNumber, provider, providerName },
    });
    if (eventError) {
      console.error("[couriers/book] could not record the shipment event", eventError.message);
    }
    // Every other route that advances fulfilment notifies the buyer; this one
    // never did, so a parcel went out and nobody told them. Best-effort and
    // last: the shipment is already saved, and a notification failure must not
    // make the seller think the booking did not stick.
    const { error: notifyError } = await admin.rpc("enqueue_order_notification", {
      p_order_id: order.id,
      p_event: "dispatched",
    });
    if (notifyError) {
      console.error("[couriers/book] could not notify the buyer", notifyError.message);
    }
  }

  return NextResponse.json({ shipment: data }, { status: 201 });
}
