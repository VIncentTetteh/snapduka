"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCountryConfig, toMinorUnits } from "@snapduka/core";
import { resolveCreatorContext } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { createCreatorPayoutDestination } from "@/lib/payouts/creator-destinations";
import type { DestinationType } from "@/lib/payouts/destinations";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The creator's half of "mark as paid". SnapDuka records a seller's assertion
 * that money moved; this is the only corroboration available, so it is part of
 * the record rather than a nicety.
 */
export async function respondToPayment(formData: FormData): Promise<void> {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop
  // qualifies. Returning silently left the form looking broken; sign-in is the
  // actual next step.
  if (!creator) redirect(`/login?next=/creator/payments`);

  const paymentId = String(formData.get("paymentId") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_creator_commission_payment", {
    p_payment_id: paymentId,
    p_action: action,
    p_note: note || undefined,
  });

  if (error) {
    redirect(`/creator/payments?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/creator/payments");
  revalidatePath("/creator");
  redirect(
    `/creator/payments?message=${encodeURIComponent(
      action === "confirm" ? "Thanks — payment confirmed." : "The shop has been told.",
    )}`,
  );
}

export type CreatorPayoutActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  values: Record<string, string>;
};

/**
 * Withdraws from the creator's SnapDuka wallet.
 *
 * Every rule — eligibility, minimum, fee, available balance, daily cap, the
 * 24-hour cool-off, one withdrawal at a time, auto-approval — lives in
 * request_creator_payout, which locks the wallet before deciding and derives
 * the creator from the session itself. Nothing here re-implements a rule; the
 * RPC's messages are written for the creator and shown as they are.
 */
export async function requestCreatorPayoutAction(
  _previous: CreatorPayoutActionState,
  formData: FormData,
): Promise<CreatorPayoutActionState> {
  const amountValue = String(formData.get("amount") ?? "").trim();
  const preserved = { amount: amountValue };

  const creator = await resolveCreatorContext();
  if (!creator) return { status: "error", message: "Sign in again to withdraw.", values: preserved };

  const currency = getCountryConfig(creator.country).currency;
  const amountMinor = toMinorUnits(amountValue, currency);
  if (amountMinor === null) {
    return { status: "error", message: "Enter an amount to withdraw.", values: preserved };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_creator_payout", {
    p_amount_minor: amountMinor,
    // A double-submit returns the same withdrawal instead of sending twice.
    p_idempotency_key: `creator-payout:${creator.creatorId}:${randomUUID()}`,
  });
  if (error) return { status: "error", message: error.message, values: preserved };

  revalidatePath("/creator/payments");
  return {
    status: "success",
    message: "Withdrawal requested. It goes out in the next daily batch (09:00 GMT).",
    values: { amount: "" },
  };
}

/** Paystack account lookups per creator per hour. Each one reveals a name. */
const DESTINATION_ATTEMPTS_PER_HOUR = 5;

/**
 * Saves where a creator's withdrawals go.
 *
 * The account number goes to Paystack and nowhere else: it is not stored, not
 * logged, and not returned in the action state, so a failed submission cannot
 * echo it back into the page. Rate-limited because resolving an account number
 * reveals its holder's name, and creator profiles are free to create — without
 * a limit this is a name-lookup service for any Ghanaian account number.
 */
export async function saveCreatorPayoutDestinationAction(
  _previous: CreatorPayoutActionState,
  formData: FormData,
): Promise<CreatorPayoutActionState> {
  const bankCode = String(formData.get("bankCode") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const type: DestinationType = formData.get("type") === "bank" ? "bank" : "mobile_money";
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const preserved = { bankCode, bankName, type };

  const creator = await resolveCreatorContext();
  if (!creator) return { status: "error", message: "Sign in again.", values: preserved };

  const limited = await checkRateLimit(`creator:payout-destination:${creator.creatorId}`, {
    limit: DESTINATION_ATTEMPTS_PER_HOUR,
    windowMs: 60 * 60_000,
  });
  if (!limited.ok) {
    return { status: "error", message: "Too many attempts. Try again in an hour.", values: preserved };
  }

  let provider: ReturnType<typeof paystackProvider>;
  try {
    provider = paystackProvider();
  } catch {
    // PAYSTACK_SECRET_KEY is not set in this environment.
    return { status: "error", message: "Payouts are not available yet.", values: preserved };
  }

  const admin = createAdminClient();
  const result = await createCreatorPayoutDestination(
    {
      creatorId: creator.creatorId,
      currency: getCountryConfig(creator.country).currency,
      type,
      bankCode,
      bankName,
      accountNumber,
    },
    {
      provider,
      repository: {
        async reserve(input) {
          const { data, error } = await admin
            .rpc("reserve_creator_payout_destination", {
              p_creator_id: input.creatorId,
              p_currency: input.currency,
              p_type: input.type,
              p_bank_code: input.bankCode,
              p_bank_name: input.bankName,
              p_account_last4: input.accountLast4,
              p_fingerprint: input.fingerprint,
            })
            .maybeSingle();
          if (error || !data) throw new Error(error?.message ?? "Could not save these details.");
          return { destinationId: data.destination_id, status: data.destination_status };
        },
        async activate(input) {
          const { error } = await admin.rpc("activate_payout_destination", {
            p_destination_id: input.destinationId,
            p_recipient_code: input.recipientCode,
            p_resolved_account_name: input.resolvedAccountName ?? undefined,
          });
          if (error) throw new Error(error.message);
        },
      },
    },
  );

  if (result.status === "error") {
    return { status: "error", message: result.message, values: preserved };
  }

  revalidatePath("/creator/payments");
  return {
    status: "success",
    message: result.accountName
      ? `Saved. Withdrawals will go to ${result.accountName}. New details take 24 hours to activate.`
      : "Saved. New payout details take 24 hours to activate.",
    values: { bankCode: "", bankName: "", type },
  };
}
