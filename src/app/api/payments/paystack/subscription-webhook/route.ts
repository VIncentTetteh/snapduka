import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { mapPaystackSubscriptionEvent } from "@/lib/billing/subscriptions";
import { verifyPaystackWebhook } from "@/lib/payments/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get("x-paystack-signature") ?? "";
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!secret || !verifyPaystackWebhook(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const payload = JSON.parse(new TextDecoder().decode(raw));
  const nextState = mapPaystackSubscriptionEvent(payload.event);
  if (!nextState) return NextResponse.json({ received: true });
  const providerCode = payload.data?.subscription_code;
  if (typeof providerCode !== "string") return NextResponse.json({ error: "Invalid event." }, { status: 400 });

  const admin = createAdminClient();
  const { data: subscription } = await admin.from("seller_subscriptions").select("id,seller_account_id,state").eq("provider_subscription_code", providerCode).maybeSingle();
  if (!subscription) return NextResponse.json({ received: true, applied: false });
  const eventKey = String(payload.data?.id ?? createHash("sha256").update(raw).digest("hex"));
  const { error } = await admin.from("subscription_events").insert({
    subscription_id: subscription.id,
    seller_account_id: subscription.seller_account_id,
    event_key: eventKey,
    event_type: payload.event,
    payload,
  });
  if (error?.code === "23505") return NextResponse.json({ received: true, applied: false });
  if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });

  const update: Record<string, unknown> = { state: nextState, updated_at: new Date().toISOString() };
  if (nextState === "past_due") update.grace_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  if (nextState === "active") update.grace_ends_at = null;
  if (nextState === "cancelled") update.cancelled_at = new Date().toISOString();
  await admin.from("seller_subscriptions").update(update).eq("id", subscription.id);
  return NextResponse.json({ received: true, applied: true });
}
