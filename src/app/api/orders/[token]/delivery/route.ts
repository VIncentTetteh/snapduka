import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmDelivery, reissueDeliveryCode } from "@/lib/protect/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The buyer's side of Protect delivery, authorised by the tracking token:
 *
 * - `confirm`: "I received my order". No code needed — holding the tracking
 *   token already proves this is the buyer.
 * - `new_code`: rotate the delivery code and show the new one here. This is
 *   also the fallback when the SMS never arrived; the plaintext goes only to
 *   the token holder and is stored nowhere.
 */
const schema = z.object({ action: z.enum(["confirm", "new_code"]) });

const CONFIRM_MESSAGES: Record<string, [number, string]> = {
  confirmed: [200, "Thanks — delivery confirmed."],
  already_confirmed: [200, "Delivery was already confirmed."],
  not_in_transit: [409, "This order has not been dispatched yet."],
  not_found: [404, "This order is not protected."],
};

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const limited = await checkRateLimit(`protect:buyer:${token}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data: order } = await createAdminClient()
    .from("orders")
    .select("id")
    .eq("tracking_token", token)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  try {
    if (parsed.data.action === "new_code") {
      const code = await reissueDeliveryCode(order.id);
      if (!code) return NextResponse.json({ error: "A code is only available while the order is on its way." }, { status: 409 });
      return NextResponse.json({ code }, { headers: { "cache-control": "no-store, private" } });
    }
    const outcome = await confirmDelivery(order.id, "buyer_tap");
    const [status, message] = CONFIRM_MESSAGES[outcome] ?? [409, "Delivery could not be confirmed."];
    return NextResponse.json(status < 300 ? { outcome, message } : { error: message, outcome }, { status });
  } catch (error) {
    console.error("[orders/delivery] failed", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
