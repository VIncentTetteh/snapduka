import { NextResponse } from "next/server";

import { parseGuestOrder } from "@/lib/commerce/order";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseGuestOrder(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check your checkout details.", details: parsed.fieldErrors }, { status: 400 });
  }
  const growth = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const { data, error } = await createAdminClient().rpc("create_guest_order_growth", {
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
    return NextResponse.json({ error: conflict ? error.message : "We could not place the order. Please retry." }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
