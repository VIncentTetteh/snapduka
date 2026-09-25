import { getBnplProviderById } from "@/lib/bnpl/registry";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Starting a refund, shared by the seller/operator refund route and the Protect
 * dispute resolution handler.
 *
 * Moved verbatim from src/app/api/payments/paystack/refund/route.ts, whose
 * header explains the claim-before-spend ordering; the route is now an adapter.
 *
 * One behaviour fix: when Paystack answers the refund call with `processed`
 * straight away, the row is written as `completed` here — and the webhook's
 * ledger clawback only fires on the transition INTO completed, which then never
 * happens. The seller kept money that had gone back to the buyer. The clawback
 * now runs here in that case; its ledger event key makes a later webhook
 * replay a no-op.
 */

/**
 * The provider that took the payment refunds it. A BNPL order was paid by the
 * partner (route_reason `bnpl:<partner>`), so its refund must go back through
 * that partner; sending it to Paystack would fail, or worse, refund money
 * Paystack never received.
 */
function refundProviderFor(attempt: { provider?: string | null; route_reason?: string | null }) {
  if (attempt.provider === "bnpl") {
    const partnerId = attempt.route_reason?.startsWith("bnpl:") ? attempt.route_reason.slice(5) : "";
    const partner = getBnplProviderById(partnerId);
    if (!partner) throw new Error(`BNPL partner ${partnerId || "(unknown)"} is not available to refund`);
    return partner;
  }
  return paystackProvider();
}

function mapInitialRefundStatus(providerStatus: string): "processing" | "completed" | "failed" {
  if (providerStatus === "processed") return "completed";
  if (providerStatus === "failed") return "failed";
  return "processing";
}

export type StartRefundInput = {
  orderId: string;
  /** Scope to one seller's orders; omit only for operator/system callers. */
  sellerAccountId?: string;
  amountMinor?: number;
};

export type StartRefundResult =
  | { ok: true; refundId: string; status: "processing" | "completed" }
  | {
      ok: false;
      reason:
        | "not_refundable"
        | "no_paid_attempt"
        | "fully_refunded"
        | "amount_too_large"
        | "in_flight"
        | "claim_failed"
        | "provider_failed";
    };

export async function startRefund(input: StartRefundInput): Promise<StartRefundResult> {
  const admin = createAdminClient();
  let query = admin
    .from("orders")
    .select("id,seller_account_id,total_minor,payment_status")
    .eq("id", input.orderId);
  if (input.sellerAccountId) query = query.eq("seller_account_id", input.sellerAccountId);
  const { data: order } = await query.maybeSingle();
  if (!order || order.payment_status !== "paid") {
    return { ok: false, reason: "not_refundable" };
  }

  // An order with two paid attempts would make maybeSingle() error into null
  // and report "not found", which is misleading — take the most recent instead.
  const { data: attempts } = await admin
    .from("payment_attempts")
    .select("id,reference,provider,route_reason")
    .eq("order_id", order.id)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1);
  const attempt = attempts?.[0];
  if (!attempt) return { ok: false, reason: "no_paid_attempt" };

  const { data: priorRefunds } = await admin
    .from("refunds")
    .select("amount_minor")
    .eq("order_id", order.id)
    .neq("status", "failed");
  const alreadyRefundedMinor = (priorRefunds ?? []).reduce((sum, row) => sum + row.amount_minor, 0);
  const remainingMinor = order.total_minor - alreadyRefundedMinor;
  if (remainingMinor <= 0) {
    return { ok: false, reason: "fully_refunded" };
  }

  const amount = input.amountMinor ?? remainingMinor;
  if (amount > remainingMinor) return { ok: false, reason: "amount_too_large" };

  // Claim the amount before spending it. `requested` counts toward the balance
  // above, so a concurrent caller cannot also claim it.
  const { data: claimed, error: claimError } = await admin
    .from("refunds")
    .insert({
      order_id: order.id,
      payment_attempt_id: attempt.id,
      seller_account_id: order.seller_account_id,
      amount_minor: amount,
      status: "requested",
    })
    .select("id")
    .single();

  if (claimError || !claimed) {
    // 23505 is the in-flight index: someone else is already refunding this order.
    return { ok: false, reason: claimError?.code === "23505" ? "in_flight" : "claim_failed" };
  }

  let status: "processing" | "completed" | "failed";
  try {
    const result = await refundProviderFor(attempt).refund({
      reference: attempt.reference,
      amountMinor: amount,
    });
    status = mapInitialRefundStatus(result.status);
    await admin
      .from("refunds")
      .update({ provider_refund_id: result.providerId, status })
      .eq("id", claimed.id);
  } catch (error) {
    // Release the claim so the amount is refundable again — `failed` is the one
    // status the balance query excludes.
    await admin.from("refunds").update({ status: "failed" }).eq("id", claimed.id);
    console.error("[refund] provider call failed", { orderId: order.id, error });
    return { ok: false, reason: "provider_failed" };
  }
  if (status === "failed") {
    return { ok: false, reason: "provider_failed" };
  }

  if (status === "completed") {
    const { error: ledgerError } = await admin.rpc("apply_refund_to_ledger", {
      p_refund_id: claimed.id,
    });
    if (ledgerError) {
      // The buyer has their money; the seller's wallet has not been debited.
      // The reconciliation job will show the gap — make sure a human does too.
      console.error("[refund] ledger clawback failed", { refundId: claimed.id, error: ledgerError });
    }
  }

  const { error: orderError } = await admin
    .from("orders")
    .update({ refund_status: "processing" })
    .eq("id", order.id)
    .eq("refund_status", "none");
  if (orderError) {
    // The money is already moving, so this is not a failure to report to the
    // caller — but it must not vanish: refund_status gates settlement release.
    console.error("[refund] order refund_status not updated", { orderId: order.id, error: orderError });
  }

  return { ok: true, refundId: claimed.id, status };
}
