import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders")
    .select("public_reference,status,payment_status,fulfillment_status,currency,subtotal_minor,delivery_minor,total_minor,fulfillment_method_snapshot,created_at,order_lines(product_name,variant_name,quantity,unit_price_minor,line_total_minor),order_events(event_type,buyer_visible,created_at)")
    .eq("tracking_token", token).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json({
    ...order,
    order_events: order.order_events.filter((event) => event.buyer_visible),
  }, { headers: { "cache-control": "no-store, private" } });
}
