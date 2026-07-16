import type { CurrencyCode } from "@/lib/countries/types";

export type PayoutRecord = {
  amountMinor: number;
  feeMinor: number;
  status: "requested" | "approved" | "rejected" | "paid";
};

/** Flat processing fee per payout, in minor units. */
export function payoutFeeMinor(currency: CurrencyCode): number {
  return currency === "XOF" ? 500 : 100;
}

/** Minimum payout amount, in minor units. */
export function minimumPayoutMinor(currency: CurrencyCode): number {
  return currency === "XOF" ? 5000 : 5000;
}

/**
 * Available balance = everything earned from paid orders minus everything
 * already committed to payouts (rejected requests release their funds).
 */
export function calculateAvailableBalance(input: {
  paidOrdersTotalMinor: number;
  payouts: PayoutRecord[];
}): number {
  const committed = input.payouts
    .filter((payout) => payout.status !== "rejected")
    .reduce((sum, payout) => sum + payout.amountMinor, 0);
  return Math.max(0, input.paidOrdersTotalMinor - committed);
}

export type PayoutValidation =
  | { ok: true; amountMinor: number; feeMinor: number; receivesMinor: number }
  | { ok: false; error: string };

/** Validates a requested amount (already in minor units) against the balance. */
export function validatePayoutRequest(input: {
  amountMinor: number;
  availableMinor: number;
  currency: CurrencyCode;
}): PayoutValidation {
  const { amountMinor, availableMinor, currency } = input;
  const fee = payoutFeeMinor(currency);
  const minimum = minimumPayoutMinor(currency);

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  if (amountMinor < minimum) {
    return { ok: false, error: "Amount is below the minimum payout." };
  }
  if (amountMinor > availableMinor) {
    return { ok: false, error: "Amount exceeds your available balance." };
  }
  if (amountMinor <= fee) {
    return { ok: false, error: "Amount must be more than the payout fee." };
  }
  return { ok: true, amountMinor, feeMinor: fee, receivesMinor: amountMinor - fee };
}

/** Converts a major-unit user input ("31.20") to minor units for a currency. */
export function toMinorUnits(value: string, currency: CurrencyCode): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(currency === "XOF" ? parsed : parsed * 100);
}
