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

  // Transfers out. Until now no transfer.* event was handled at all, so a
  // withdrawal could leave SnapDuka's account with nothing recording that it
  // had. This is the only path allowed to declare that a payout settled —
  // neither operators nor the execute worker may.
  if (typeof payload.event === "string" && payload.event.startsWith("transfer.")) {
    const reference = payload.data?.reference;
    const status = payload.data?.status;
    if (typeof reference !== "string" || typeof status !== "string") {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }
    const { error } = await admin.rpc("apply_paystack_transfer_event", {
      p_event_key: eventKey,
      p_reference: reference,
      // Required in SQL, nullable in practice: a rejected transfer never got an id.
      p_transfer_id: (payload.data?.id == null ? null : String(payload.data.id)) as string,
      // transfer.success / transfer.failed / transfer.reversed all carry the
      // outcome in data.status, so the RPC branches on that rather than on the
      // event name.
      p_status: status,
      p_payload: payload,
    });
    if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
