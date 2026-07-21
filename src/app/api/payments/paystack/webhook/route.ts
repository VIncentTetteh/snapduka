import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { enqueueOrderEventNotification } from "@/lib/notifications/enqueue";
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
  const admin = createAdminClient();
  const eventKey = `${payload.event}:${String(payload.data?.id ?? createHash("sha256").update(raw).digest("hex"))}`;

  if (payload.event === "charge.success") {
    const reference = payload.data?.reference;
    if (typeof reference !== "string") return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    const { data, error } = await admin.rpc("apply_paystack_success", {
      p_reference: reference, p_event_key: eventKey, p_payload: payload,
    });
    if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
    if (data) {
      const { data: attempt } = await admin
        .from("payment_attempts")
        .select("order_id")
        .eq("reference", reference)
        .maybeSingle();
      if (attempt?.order_id) {
        await enqueueOrderEventNotification(admin, attempt.order_id, "payment_succeeded");
      }
    }
    return NextResponse.json({ received: true, applied: data });
  }

  if (typeof payload.event === "string" && payload.event.startsWith("refund.")) {
    const refundId = payload.data?.id;
    const status = payload.data?.status;
    if (refundId == null || typeof status !== "string") {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }
    const { error } = await admin.rpc("apply_paystack_refund_event", {
      p_event_key: eventKey, p_provider_refund_id: String(refundId), p_status: status, p_payload: payload,
    });
    if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
