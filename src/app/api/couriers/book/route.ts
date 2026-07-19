import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isSafeHttpUrl } from "@/lib/catalog/video";
import { courierAdapter } from "@/lib/couriers/registry";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ orderId: z.uuid(), provider: z.literal("manual").default("manual"), quoteId: z.string().min(1).max(200), trackingNumber: z.string().trim().min(2).max(100).optional(), trackingUrl: z.url().refine(isSafeHttpUrl, "Tracking URL must be http(s).").optional() });

export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "orders.manage")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the tracking details." }, { status: 400 });
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("id,fulfillment_status").eq("id", parsed.data.orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  try {
    const shipment = await courierAdapter(parsed.data.provider).book(parsed.data);
    const { data, error } = await supabase.from("shipments").upsert({ label_url: shipment.labelUrl, order_id: parsed.data.orderId, provider: shipment.provider, provider_shipment_id: shipment.id, seller_account_id: actor.sellerAccountId, status: shipment.status, tracking_number: shipment.trackingNumber, tracking_url: shipment.trackingUrl }, { onConflict: "order_id" }).select().single();
    if (error) return NextResponse.json({ error: "Booking could not be saved." }, { status: 500 });
    // A booked shipment means the order is on its way — advance the buyer
    // timeline unless fulfilment is already past dispatch.
    if (["unconfirmed", "confirmed", "preparing"].includes(order.fulfillment_status)) {
      await supabase
        .from("orders")
        .update({ fulfillment_status: "dispatched" })
        .eq("id", order.id)
        .eq("seller_account_id", actor.sellerAccountId);
      await supabase.from("order_events").insert({
        order_id: order.id,
        seller_account_id: actor.sellerAccountId,
        event_type: "shipment_booked",
        actor_type: "seller",
        buyer_visible: true,
        data: { trackingNumber: shipment.trackingNumber, provider: shipment.provider },
      });
    }
    return NextResponse.json({ shipment: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The courier booking failed." }, { status: 502 });
  }
}
