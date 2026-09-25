import "server-only";

import type { BnplOutcome } from "@/lib/bnpl/provider";
import { enqueueOrderEventNotification } from "@/lib/notifications/enqueue";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * payment_attempts.route_reason for a BNPL attempt: binds the attempt to the
 * partner that started it, so only that partner's signed webhook can capture it.
 */
export function bnplRouteReason(partnerId: string): string {
  return `bnpl:${partnerId}`;
}

export type BnplApplyResult = "captured" | "not_applied" | "declined" | "ignored";

/**
 * Applies one verified BNPL partner outcome.
 *
 * An approval is a capture: the partner has paid SnapDuka the full order
 * total, so it goes through apply_paystack_success — the one function that
 * marks an order paid, consumes stock, books the settlement and ledger and
 * opens Protect. Forking that for BNPL would mean two capture paths to keep
 * in step forever (ADR-0014). The payload is normalised to the shape it
 * checks (data.status / amount / currency / fees), so an amount or currency
 * mismatch is refused there exactly as it is for Paystack. The event key is
 * namespaced `bnpl:<partner>:<event id>` because provider_events is keyed per
 * provider and that function records every event under 'paystack'.
 *
 * Only an attempt this partner started is touched: anything else is ignored,
 * so a BNPL partner's credentials can never mark a card payment paid.
 */
export async function applyBnplOutcome(partnerId: string, outcome: BnplOutcome): Promise<BnplApplyResult> {
  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("id,order_id,provider,route_reason,status")
    .eq("reference", outcome.reference)
    .maybeSingle();
  if (!attempt || attempt.provider !== "bnpl" || attempt.route_reason !== bnplRouteReason(partnerId)) {
    return "ignored";
  }

  if (outcome.status === "declined") {
    const { error } = await admin
      .from("payment_attempts")
      .update({ status: "failed" })
      .eq("id", attempt.id)
      .eq("status", "pending");
    if (error) throw new Error(`could not record BNPL decline: ${error.message}`);
    return "declined";
  }

  const { data: applied, error } = await admin.rpc("apply_paystack_success", {
    p_reference: outcome.reference,
    p_event_key: `bnpl:${partnerId}:${outcome.eventId}`,
    p_payload: {
      event: "bnpl.approved",
      data: {
        status: "success",
        reference: outcome.reference,
        amount: outcome.amountMinor,
        currency: outcome.currency,
        fees: outcome.feeMinor,
        channel: "bnpl",
        partner: partnerId,
      },
    },
  });
  if (error) throw new Error(`BNPL capture failed: ${error.message}`);
  // False: a replay, an order already paid, or an amount/currency mismatch —
  // apply_paystack_success records the event either way.
  if (!applied) return "not_applied";

  if (attempt.order_id) await enqueueOrderEventNotification(admin, attempt.order_id, "payment_succeeded");
  return "captured";
}
