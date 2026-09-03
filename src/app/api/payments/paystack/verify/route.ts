import { NextResponse } from "next/server";
import { z } from "zod";

import { enqueueOrderEventNotification } from "@/lib/notifications/enqueue";
import { paystackProvider } from "@/lib/payments/paystack";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ reference: z.string().min(8).max(120) });

/**
 * Paystack states that mean the transaction will never complete. Anything else
 * non-success ('ongoing', 'pending', 'queued') is still in progress.
 */
const TERMINAL_PROVIDER_FAILURES = new Set(["abandoned", "failed", "reversed"]);

/**
 * Buyer-initiated payment confirmation, called when Paystack redirects back
 * to the tracking page. Verifies the transaction with Paystack and applies
 * the same idempotent RPC the webhook uses — this is the primary confirmation
 * path in local dev (webhooks can't reach localhost) and a safety net in
 * production when the webhook is delayed.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`paystack:verify:${ip}`, { limit: 20, windowMs: 5 * 60 * 1000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reference." }, { status: 400 });
  }
  const reference = parsed.data.reference;

  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("status")
    .eq("reference", reference)
    .maybeSingle();
  if (!attempt) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (attempt.status === "paid") {
    return NextResponse.json({ paymentStatus: "paid" });
  }

  let verified;
  try {
    verified = await paystackProvider().verify(reference);
  } catch {
    return NextResponse.json(
      { error: "Payment could not be verified yet. It will confirm automatically." },
      { status: 502 },
    );
  }

  if (verified.status !== "success") {
    // Close the attempt out when Paystack says it is over. Without this the row
    // stays 'pending' forever: two such rows sat in production for a month,
    // indistinguishable from a payment still in flight, and every abandoned
    // checkout adds another. 'ongoing' and 'pending' are NOT terminal — the
    // buyer is still on the payment page and the attempt must stay open.
    const settledStatus = TERMINAL_PROVIDER_FAILURES.has(verified.status)
      ? "failed"
      : attempt.status;

    if (settledStatus !== attempt.status) {
      await admin
        .from("payment_attempts")
        .update({ status: settledStatus })
        .eq("reference", reference)
        // Never overwrite a terminal state: a webhook may have landed first.
        .eq("status", "pending");
    }
    return NextResponse.json({ paymentStatus: settledStatus, providerStatus: verified.status });
  }

  // Same shape the webhook passes; the RPC re-validates status, amount and
  // currency against the order and dedupes by event key.
  const { data: applied, error } = await admin.rpc("apply_paystack_success", {
    p_reference: reference,
    p_event_key: `verify:${reference}`,
    p_payload: {
      source: "verify",
      data: {
        status: verified.status,
        amount: verified.amountMinor,
        currency: verified.currency,
        reference: verified.reference,
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: "Payment could not be recorded." }, { status: 500 });
  }

  if (applied) {
    const { data: paidAttempt } = await admin
      .from("payment_attempts")
      .select("order_id")
      .eq("reference", reference)
      .maybeSingle();
    if (paidAttempt?.order_id) {
      await enqueueOrderEventNotification(admin, paidAttempt.order_id, "payment_succeeded");
    }
  }

  // Re-read rather than reporting `attempt.status`, which was captured before
  // the RPC ran. `applied` is false both when nothing happened AND when the
  // webhook won the race and applied the payment first — in the second case the
  // stale value would tell a buyer their paid order is still pending.
  const { data: settled } = await admin
    .from("payment_attempts")
    .select("status")
    .eq("reference", reference)
    .maybeSingle();

  return NextResponse.json({ paymentStatus: settled?.status ?? attempt.status });
}
