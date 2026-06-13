import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

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
  if (payload.event !== "charge.success") return NextResponse.json({ received: true });
  const reference = payload.data?.reference;
  if (typeof reference !== "string") return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const eventKey = String(payload.data?.id ?? createHash("sha256").update(raw).digest("hex"));
  const { data, error } = await createAdminClient().rpc("apply_paystack_success", {
    p_reference: reference, p_event_key: eventKey, p_payload: payload,
  });
  if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
  return NextResponse.json({ received: true, applied: data });
}
