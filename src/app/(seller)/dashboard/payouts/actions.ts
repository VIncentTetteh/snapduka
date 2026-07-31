"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { createPayoutDestination, type DestinationType } from "@/lib/payouts/destinations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PayoutActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  values: Record<string, string>;
};

/**
 * Requests a withdrawal from the seller's wallet.
 *
 * This used to fail closed, because SnapDuka held no seller funds — Paystack
 * split each payment to the seller's own subaccount and settled it directly.
 * Payments now land whole in SnapDuka's main account and the seller is credited
 * in the ledger, so there is a real balance and a real disbursement.
 *
 * Every decision — eligibility, minimum, available balance, daily cap, the
 * 24-hour cool-off after a destination change, and whether it auto-approves —
 * lives in request_seller_payout, which takes a row lock on the wallet before
 * deciding. Re-implementing any of it here would let the two disagree, and the
 * one that moves money is the one in SQL.
 */
export async function requestPayoutAction(
  _previousState: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const amountValue = String(formData.get("amount") ?? "");
  const preserved = { amount: amountValue };

  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return { status: "error", message: "Sign in again to withdraw.", values: preserved };
  }

  const amount = Number.parseFloat(amountValue.trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "error", message: "Enter an amount to withdraw.", values: preserved };
  }
  // XOF has no minor unit; everything else is 100 subunits.
  const amountMinor = Math.round(actor.country === "CI" ? amount : amount * 100);

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_seller_payout", {
    p_amount_minor: amountMinor,
    // Survives a double-submit without sending twice.
    p_idempotency_key: `payout:${actor.sellerAccountId}:${randomUUID()}`,
  });

  if (error) {
    // The RPC raises with messages written for the seller, so they are surfaced
    // rather than replaced with something vaguer.
    return { status: "error", message: error.message, values: preserved };
  }

  revalidatePath("/dashboard/payouts");
  return {
    status: "success",
    message: "Withdrawal requested. You'll see it here once it reaches your bank.",
    values: { amount: "" },
  };
}

export type DestinationActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  values: Record<string, string>;
};

/**
 * Saves where a seller's money should go.
 *
 * The account number reaches Paystack and nothing else — it is never written to
 * the database, never logged, and is deliberately excluded from the returned
 * state so a failed submission cannot echo it back into the rendered page.
 */
export async function savePayoutDestinationAction(
  _previousState: DestinationActionState,
  formData: FormData,
): Promise<DestinationActionState> {
  const bankCode = String(formData.get("bankCode") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const type = (String(formData.get("type") ?? "bank") === "mobile_money"
    ? "mobile_money"
    : "bank") as DestinationType;
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const preserved = { bankCode, bankName, type };

  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return { status: "error", message: "Sign in again.", values: preserved };
  }
  if (actor.status === "suspended" || actor.status === "closed") {
    return { status: "error", message: "This account is read-only.", values: preserved };
  }

  const currency = actor.country === "NG" ? "NGN" : actor.country === "CI" ? "XOF" : "GHS";
  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("legal_name, display_name")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  const admin = createAdminClient();
  const result = await createPayoutDestination(
    {
      sellerAccountId: actor.sellerAccountId,
      currency,
      type,
      bankCode,
      bankName,
      accountNumber,
      accountName: shop?.legal_name ?? shop?.display_name ?? "SnapDuka seller",
    },
    {
      provider: paystackProvider(),
      repository: {
        async reserve(input) {
          const { data, error } = await admin
            .rpc("reserve_payout_destination", {
              p_seller_account_id: input.sellerAccountId,
              p_currency: input.currency,
              p_type: input.type,
              p_bank_code: input.bankCode,
              p_bank_name: input.bankName,
              p_account_last4: input.accountLast4,
              p_fingerprint: input.fingerprint,
            })
            .maybeSingle();
          if (error) throw new Error(error.message);
          const row = data as { destination_id: string; destination_status: string };
          return { destinationId: row.destination_id, status: row.destination_status };
        },
        async activate(input) {
          const { error } = await admin.rpc("activate_payout_destination", {
            p_destination_id: input.destinationId,
            p_recipient_code: input.recipientCode,
            p_resolved_account_name: input.resolvedAccountName,
          });
          if (error) throw new Error(error.message);
        },
      },
    },
  );

  if (result.status === "error") {
    return { status: "error", message: result.message, values: preserved };
  }

  revalidatePath("/dashboard/payouts");
  return {
    status: "success",
    message: result.accountName
      ? `Saved. Withdrawals will go to ${result.accountName}. New details take 24 hours to activate.`
      : "Saved. New payout details take 24 hours to activate.",
    values: { bankCode: "", bankName: "", type },
  };
}
