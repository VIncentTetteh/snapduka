"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import {
  calculateAvailableBalance,
  toMinorUnits,
  validatePayoutRequest,
  type PayoutRecord,
} from "@/lib/payouts/balance";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export type PayoutActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  values: Record<string, string>;
};

export async function requestPayoutAction(
  _previousState: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const amountValue = String(formData.get("amount") ?? "");
  const preserved = { amount: amountValue };
  const actor = await resolveServerActor();

  if (actor.kind !== "seller") {
    return { status: "error", message: "Sign in again to request a payout.", values: preserved };
  }
  if (actor.status === "suspended" || actor.status === "closed") {
    return {
      status: "error",
      message: "Payouts are unavailable while this account is restricted.",
      values: preserved,
    };
  }

  const currency = (actor.country === "NG" ? "NGN" : actor.country === "CI" ? "XOF" : "GHS") as CurrencyCode;
  const amountMinor = toMinorUnits(amountValue, currency);
  if (amountMinor == null) {
    return { status: "error", message: "Enter a valid amount.", values: preserved };
  }

  const supabase = await createClient();
  const [{ data: paidOrders }, { data: payouts }, { data: settlement }] = await Promise.all([
    supabase
      .from("orders")
      .select("total_minor")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("payment_status", "paid"),
    supabase
      .from("payout_requests")
      .select("amount_minor,fee_minor,status")
      .eq("seller_account_id", actor.sellerAccountId),
    supabase
      .from("settlement_profiles")
      .select("bank_name,account_last4")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("provider", "paystack")
      .maybeSingle(),
  ]);

  const available = calculateAvailableBalance({
    paidOrdersTotalMinor: paidOrders?.reduce((sum, order) => sum + order.total_minor, 0) ?? 0,
    payouts: (payouts ?? []).map(
      (payout): PayoutRecord => ({
        amountMinor: payout.amount_minor,
        feeMinor: payout.fee_minor,
        status: payout.status as PayoutRecord["status"],
      }),
    ),
  });

  const validation = validatePayoutRequest({ amountMinor, availableMinor: available, currency });
  if (!validation.ok) {
    return { status: "error", message: validation.error, values: preserved };
  }

  const { error } = await supabase.from("payout_requests").insert({
    seller_account_id: actor.sellerAccountId,
    amount_minor: validation.amountMinor,
    fee_minor: validation.feeMinor,
    currency,
    destination: settlement
      ? { bankName: settlement.bank_name, accountLast4: settlement.account_last4 }
      : {},
  });

  if (error) {
    return {
      status: "error",
      message: "We could not submit the payout request. Please try again.",
      values: preserved,
    };
  }

  revalidatePath("/dashboard/payouts");
  return {
    status: "success",
    message: "Request submitted — payouts are reviewed within 24 hours.",
    values: {},
  };
}
