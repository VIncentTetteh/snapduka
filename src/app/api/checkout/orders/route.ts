import { NextResponse } from "next/server";

import { parseGuestOrder } from "@/lib/commerce/order";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const parsed = parseGuestOrder(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check your checkout details.", details: parsed.fieldErrors }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc("create_guest_order", {
    p_shop_id: parsed.data.shopId,
    p_fulfillment_method_id: parsed.data.fulfillmentMethodId,
    p_buyer: parsed.data.buyer,
    p_lines: parsed.data.lines,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_payment_method: parsed.data.paymentMethod,
  });
  if (error) {
    const conflict = /unavailable|stock/i.test(error.message);
    return NextResponse.json({ error: conflict ? error.message : "We could not place the order. Please retry." }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
