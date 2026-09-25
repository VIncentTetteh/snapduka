import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isSafeHttpUrl } from "@/lib/catalog/video";
import { bookOrderWithAdapter, type AdapterBookingOutcome } from "@/lib/couriers/booking";
import { courierLabel, isCourierKey, requiresCustomName } from "@/lib/couriers/catalogue";
import { isIntegratedCourier, resolveBookingAdapter } from "@/lib/couriers/registry";
import { advanceFulfillment } from "@/lib/orders/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRequestScopedClient } from "@/lib/supabase/request";

const schema = z
  .object({
    orderId: z.uuid(),
    // Was z.literal("manual"), which is why every shipment ever recorded said
    // "manual" and the buyer could not be told who was delivering.
    // Catalogue couriers, plus couriers that exist only as an integration
    // (the sandbox). Whether an integration may actually be used is decided
    // below, per seller, by its flag.
    provider: z
      .string()
      .trim()
      .refine((value) => isCourierKey(value) || isIntegratedCourier(value), "Unknown courier."),
    // Only used for 'other'. Bounded because it is rendered to the buyer.
    providerName: z.string().trim().min(2).max(60).optional(),
    trackingNumber: z.string().trim().min(2).max(100).optional(),
    trackingUrl: z.url().refine(isSafeHttpUrl, "Tracking URL must be http(s).").optional(),
  })
  .refine(
    (value) =>
      !isCourierKey(value.provider) || !requiresCustomName(value.provider) || Boolean(value.providerName),
    {
      message: "Name the courier.",
      path: ["providerName"],
    },
  );

const FAILURE_STATUS: Record<Extract<AdapterBookingOutcome, { ok: false }>["reason"], number> = {
  no_pickup_address: 409,
  no_delivery_address: 409,
  missing_contact: 409,
  courier_rejected: 422,
  courier_unavailable: 502,
  not_billable: 409,
};

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

  const supabase = await createRequestScopedClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id,status,fulfillment_status,shop_id,public_reference,currency,subtotal_minor,total_minor,payment_method,buyer_snapshot",
    )
    .eq("id", parsed.data.orderId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status === "pending" || order.status === "draft") {
    // Nothing leaves the shop before the order is confirmed: for Protect orders
    // dispatch issues the buyer's delivery code, and for cash orders the seller
    // has not yet agreed to the sale.
    return NextResponse.json(
      { error: "Confirm the order before booking delivery." },
      { status: 409 },
    );
  }

  // A courier with a live integration, switched on for this seller, is booked
  // through its API. Everything else — every courier until its partner gives
  // us access, and any integration whose flag is off — stays seller-arranged.
  const adapter = await resolveBookingAdapter(parsed.data.provider, {
    sellerAccountId: actor.sellerAccountId,
    country: actor.country,
  });
  if (!adapter && !isCourierKey(parsed.data.provider)) {
    return NextResponse.json({ error: "This courier is not available for booking." }, { status: 400 });
  }

  // A partner rider already on the way must be cancelled before the delivery
  // is recorded as something else; overwriting the row would orphan a live
  // booking and send two riders.
  const { data: existing } = await supabase
    .from("shipments")
    .select("provider,booked_via,status")
    .eq("order_id", parsed.data.orderId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (
    existing?.booked_via === "adapter" &&
    ["booked", "in_transit"].includes(existing.status) &&
    existing.provider !== parsed.data.provider
  ) {
    return NextResponse.json(
      { error: "This order already has a courier booked. Cancel that booking first." },
      { status: 409 },
    );
  }

  let platformChargeMinor: number | null = null;
  let shipmentRow: {
    provider: string;
    provider_name: string;
    tracking_number: string;
    tracking_url: string | null;
    provider_shipment_id: string | null;
    label_url: string | null;
    booked_via: "seller" | "adapter";
  };

  if (adapter) {
    const outcome = await bookOrderWithAdapter({
      adapter,
      order,
      sellerAccountId: actor.sellerAccountId,
      country: actor.country,
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.message }, { status: FAILURE_STATUS[outcome.reason] });
    }
    platformChargeMinor = outcome.platformCharge
      ? (outcome.result.amountMinor ?? outcome.platformCharge.estimateMinor)
      : null;
    shipmentRow = {
      provider: adapter.id,
      provider_name: adapter.label,
      tracking_number: outcome.result.trackingNumber,
      tracking_url: outcome.result.trackingUrl,
      provider_shipment_id: outcome.result.providerBookingId,
      label_url: outcome.result.labelUrl,
      booked_via: "adapter",
    };
  } else {
    // Seller-arranged delivery involves no provider API — the seller has already
    // booked the rider themselves and is recording what they arranged.
    const provider = parsed.data.provider as Parameters<typeof courierLabel>[0];
    shipmentRow = {
      provider,
      // Resolved here, not in the browser: a seller must not be able to label a
      // Bolt delivery as something else on the buyer's receipt.
      provider_name: courierLabel(provider, parsed.data.providerName),
      tracking_number:
        parsed.data.trackingNumber ?? `SD-${parsed.data.orderId.slice(0, 8).toUpperCase()}`,
      tracking_url: parsed.data.trackingUrl ?? null,
      provider_shipment_id: null,
      label_url: null,
      booked_via: "seller",
    };
  }
  const { provider, provider_name: providerName, tracking_number: trackingNumber } = shipmentRow;

  const { data, error } = await supabase
    .from("shipments")
    .upsert(
      {
        order_id: parsed.data.orderId,
        seller_account_id: actor.sellerAccountId,
        ...shipmentRow,
        status: "booked",
      },
      { onConflict: "order_id" },
    )
    .select()
    .single();
  if (error) {
    if (adapter) {
      // The partner has the booking and we could not record it. Loud, because
      // support must reconcile it by hand; the order id is the partner's key.
      console.error(
        `[couriers/book] ${adapter.id} booked ${shipmentRow.provider_shipment_id} for ${parsed.data.orderId} but the shipment was not saved`,
        error.message,
      );
    }
    return NextResponse.json({ error: "Booking could not be saved." }, { status: 500 });
  }

  // Delivery booked on SnapDuka's courier account: recover the cost (plus
  // SnapDuka's margin) from the order's held settlement. A null result means it
  // could no longer be covered; the SQL raised a courier.charge_unrecovered
  // event for operators, and the booking itself stands.
  if (platformChargeMinor !== null) {
    const { data: charged, error: chargeError } = await createAdminClient().rpc("charge_courier_booking", {
      p_shipment_id: data.id,
      p_cost_minor: platformChargeMinor,
    });
    if (chargeError || charged === null) {
      console.error(`[couriers/book] courier charge not recovered for ${parsed.data.orderId}`, chargeError?.message);
    }
  }

  // A booked shipment means the order is on its way. The shipment_booked event
  // records *who* is delivering; the dispatch itself goes through the guarded
  // fulfilment path, which records its own event and notifies the buyer. An
  // order already past dispatch (e.g. correcting a tracking number on a
  // delivered order) is left alone so the buyer is not told it just shipped.
  if (["unconfirmed", "confirmed", "preparing"].includes(order.fulfillment_status)) {
    // The admin client, deliberately: order_events has no INSERT policy for
    // `authenticated`. Ownership is enforced by the order lookup above.
    const admin = createAdminClient();
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
    const dispatched = await advanceFulfillment({
      sellerAccountId: actor.sellerAccountId,
      orderId: order.id,
      next: "dispatched",
      source: "booking",
      detail: { trackingNumber, provider },
    });
    if (!dispatched.ok) {
      // The shipment is saved; failing now would make the seller think it was
      // not. A conflict here means someone else moved the order in between.
      console.error("[couriers/book] could not advance fulfilment", dispatched.reason);
    }
  }

  return NextResponse.json({ shipment: data }, { status: 201 });
}
