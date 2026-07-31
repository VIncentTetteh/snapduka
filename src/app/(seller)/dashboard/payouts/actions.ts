"use server";

import { resolveServerActor } from "@/lib/auth/actor";

export type PayoutActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  values: Record<string, string>;
};

/**
 * Disabled: SnapDuka holds no seller funds, so there is nothing to pay out.
 *
 * Online sales are collected into the seller's own Paystack subaccount and
 * settled to their bank by Paystack; offline sales are collected by the seller
 * in cash. There is no Transfer integration for SnapDuka to disburse with, and
 * "paid" on a payout request was only ever an operator flipping a status after
 * moving money by hand — against a balance that summed money the seller had
 * already received.
 *
 * The action is kept and fails closed rather than deleted, so the seller UI,
 * the operator screen and the existing payout_requests rows stay coherent and
 * a real disbursement flow can be built here later.
 */
export async function requestPayoutAction(
  _previousState: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const preserved = { amount: String(formData.get("amount") ?? "") };
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return { status: "error", message: "Sign in again.", values: preserved };
  }
  return {
    status: "error",
    message:
      "Payout requests are not needed — Paystack settles your online sales straight to your bank, and offline orders you collect yourself.",
    values: preserved,
  };
}
