import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { isShipmentStatus, type NormalizedShipmentEvent, type ShipmentStatus } from "@snapduka/core";

import { getCourierAdapter, isIntegratedCourier } from "@/lib/couriers/registry";
import { advanceFulfillment, type FulfillmentStep } from "@/lib/orders/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Courier status webhooks.
 *
 * Shipment progress drives the buyer's order timeline, but it used to do so by
 * writing `orders.fulfillment_status` directly — no state machine, no version
 * bump, and no notification, so a parcel could be marked delivered without the
 * buyer ever hearing. It now goes through `advanceFulfillment`, the same guarded
 * path as every other fulfilment change. A report the state machine rejects
 * (say, "in transit" for an order that is already fulfilled) is still recorded
 * as a shipment event; it just does not move the order.
 */

const FULFILLMENT_FOR: Partial<Record<ShipmentStatus, FulfillmentStep>> = {
  in_transit: "dispatched",
  delivered: "fulfilled",
};

function bearerAuthorised(request: Request, provider: string): boolean {
  const secret = process.env[`COURIER_${provider.toUpperCase()}_WEBHOOK_SECRET`];
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * The legacy generic contract: bearer secret, one `{id?, trackingNumber,
 * status}` event per call. Kept for couriers without an integration.
 */
function legacyEvents(rawBody: string): NormalizedShipmentEvent[] | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const tracking = payload?.trackingNumber;
  const status = payload?.status;
  if (typeof tracking !== "string" || !isShipmentStatus(status) || status === "booked") return null;
  return [
    {
      eventId: String(payload.id ?? createHash("sha256").update(rawBody).digest("hex")),
      providerBookingId: null,
      trackingNumber: tracking,
      status,
      occurredAt: new Date().toISOString(),
      description: null,
    },
  ];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const rawBody = await request.text();

  // An integrated courier verifies and parses its own format (signatures are
  // over the raw bytes); everyone else uses the generic bearer contract.
  const adapter = isIntegratedCourier(provider) ? getCourierAdapter(provider) : null;
  let events: NormalizedShipmentEvent[] | null;
  if (adapter?.capabilities.webhooks) {
    const webhook = {
      rawBody,
      headers: Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value])),
    };
    if (!(await adapter.verifyWebhook(webhook))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    events = adapter.parseWebhook(webhook);
  } else {
    if (!bearerAuthorised(request, provider)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    events = legacyEvents(rawBody);
    if (!events) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  const admin = createAdminClient();
  let applied = 0;
  let advanced = 0;
  for (const event of events) {
    const outcome = await applyEvent(admin, provider, event);
    if (outcome === "error") {
      // 5xx so the courier retries rather than the event being lost.
      return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
    }
    if (outcome !== "skipped") applied += 1;
    if (outcome === "advanced") advanced += 1;
  }

  if (events.length === 1) {
    return NextResponse.json({ received: true, applied: applied === 1, ...(applied ? { advanced: advanced === 1 } : {}) });
  }
  return NextResponse.json({ received: true, applied, advanced });
}

type Admin = ReturnType<typeof createAdminClient>;

async function applyEvent(
  admin: Admin,
  provider: string,
  event: NormalizedShipmentEvent,
): Promise<"skipped" | "applied" | "advanced" | "error"> {
  let lookup = admin.from("shipments").select("id,seller_account_id,order_id").eq("provider", provider);
  lookup = event.trackingNumber
    ? lookup.eq("tracking_number", event.trackingNumber)
    : lookup.eq("provider_shipment_id", event.providerBookingId ?? "");
  const { data: shipment } = await lookup.maybeSingle();
  if (!shipment) return "skipped";

  // Couriers retry. The event key makes a redelivered webhook a no-op.
  const { error: duplicate } = await admin.from("shipment_events").insert({
    shipment_id: shipment.id,
    seller_account_id: shipment.seller_account_id,
    event_key: event.eventId,
    status: event.status,
    payload: { ...event },
  });
  if (duplicate?.code === "23505") return "skipped";
  if (duplicate) {
    console.error(`[couriers/webhook] shipment_events insert failed for ${shipment.id}`, duplicate);
    return "error";
  }

  const { error: shipmentError } = await admin
    .from("shipments")
    .update({ status: event.status })
    .eq("id", shipment.id);
  if (shipmentError) {
    console.error(`[couriers/webhook] shipment update failed for ${shipment.id}`, shipmentError);
  }

  const { error: eventError } = await admin.from("order_events").insert({
    order_id: shipment.order_id,
    seller_account_id: shipment.seller_account_id,
    event_type: `shipment_${event.status}`,
    actor_type: "provider",
    buyer_visible: true,
    data: { trackingNumber: event.trackingNumber, provider },
  });
  if (eventError) {
    console.error(`[couriers/webhook] order_events insert failed for ${shipment.order_id}`, eventError);
  }

  const next = FULFILLMENT_FOR[event.status];
  if (!next) return "applied";
  const result = await advanceFulfillment({
    sellerAccountId: shipment.seller_account_id,
    orderId: shipment.order_id,
    next,
    source: "courier",
    detail: { trackingNumber: event.trackingNumber, provider },
  });
  return result.ok ? "advanced" : "applied";
}
