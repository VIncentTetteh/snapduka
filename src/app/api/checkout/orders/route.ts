import { NextResponse } from "next/server";

import { parseGuestOrder } from "@/lib/commerce/order";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueOrderEventNotification } from "@/lib/notifications/enqueue";
import { enqueueIntegrationEvent } from "@/lib/integrations/events";

// 20 checkout attempts per IP per 10 minutes
const CHECKOUT_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = await checkRateLimit(`checkout:order:${ip}`, CHECKOUT_LIMIT);
  if (!rl.ok) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many checkout requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseGuestOrder(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check your checkout details.", details: parsed.fieldErrors },
      { status: 400 },
    );
  }

  const growth = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_guest_order_growth", {
    p_shop_id: parsed.data.shopId,
    p_fulfillment_method_id: parsed.data.fulfillmentMethodId,
    p_buyer: parsed.data.buyer,
    p_lines: parsed.data.lines,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_payment_method: parsed.data.paymentMethod,
    p_promotion_code: typeof growth.promotionCode === "string" ? growth.promotionCode : null,
    p_campaign_token: typeof growth.campaignToken === "string" ? growth.campaignToken : null,
  });

  if (error) {
    const conflict = /unavailable|stock/i.test(error.message);
    return NextResponse.json(
      { error: conflict ? error.message : "We could not place the order. Please retry." },
      { status: conflict ? 409 : 500 },
    );
  }

  const result = data as { orderId?: string } | null;
  if (result?.orderId) {
    await admin.from("abandoned_checkouts").update({ recovered_order_id: result.orderId }).eq("shop_id", parsed.data.shopId).eq("contact", parsed.data.buyer.email).is("recovered_order_id", null);
    const { data: createdOrder } = await admin.from("orders").select("customer_id,public_reference,seller_account_id,total_minor,currency").eq("id", result.orderId).maybeSingle();
    if (createdOrder) await enqueueIntegrationEvent({ data: { currency: createdOrder.currency, customerId: createdOrder.customer_id, orderId: result.orderId, reference: createdOrder.public_reference, totalMinor: createdOrder.total_minor }, eventId: `${result.orderId}:created`, eventType: "order.created", sellerAccountId: createdOrder.seller_account_id });
    await enqueueOrderEventNotification(admin, result.orderId, "order_placed");
  }

  return NextResponse.json(data, { status: 201 });
}
