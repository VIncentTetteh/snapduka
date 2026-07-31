import type { CurrencyCode } from "@/lib/countries/types";

/**
 * Seller earnings, split by where the money actually is.
 *
 * This used to expose `calculateAvailableBalance`, which summed the GROSS
 * total of paid orders and offered it as a withdrawable balance. That was
 * wrong in two independent ways, and the payouts page presented the result as
 * "Available balance" next to a "Request a payout" button:
 *
 *   * Online orders are collected by Paystack into the seller's own
 *     subaccount, and Paystack settles that subaccount to the seller's bank on
 *     its own schedule. SnapDuka never holds the money.
 *   * Offline orders (cash on delivery, pay on pickup, seller arranged) are
 *     handed to the seller directly. SnapDuka never sees that money either.
 *
 * So the balance shown was money the seller had already received, and there is
 * no Paystack Transfer integration anywhere for SnapDuka to have sent it with.
 * Approving such a request meant an operator wiring funds by hand against a
 * number that was never owed. On the demo shop it read GH₵11,422.75.
 *
 * Nothing here nets off Paystack's split. Which side of `percentage_charge`
 * receives the cut is undocumented in this codebase and unconfirmed with
 * Paystack, and publishing a net figure derived from a guess would repeat the
 * exact mistake this module exists to correct.
 */

/** Payment methods where the buyer pays SnapDuka's provider, not the seller. */
const ONLINE_METHODS = new Set(["paystack"]);

export type EarningsOrder = {
  totalMinor: number;
  paymentMethod: string;
  paymentStatus: string;
};

export type EarningsSummary = {
  /** Paid online. Paystack settles the seller's share to their bank directly. */
  settledOnlineMinor: number;
  /** Paid offline. The seller already holds this money. */
  collectedOfflineMinor: number;
  /** Confirmed but not yet paid. */
  awaitingPaymentMinor: number;
  /** Refunded back to buyers, for context against the totals above. */
  refundedMinor: number;
  /** Everything actually paid, however it was collected. */
  totalPaidMinor: number;
};

export function summariseEarnings(orders: EarningsOrder[]): EarningsSummary {
  const summary: EarningsSummary = {
    settledOnlineMinor: 0,
    collectedOfflineMinor: 0,
    awaitingPaymentMinor: 0,
    refundedMinor: 0,
    totalPaidMinor: 0,
  };

  for (const order of orders) {
    if (order.paymentStatus === "refunded") {
      summary.refundedMinor += order.totalMinor;
      continue;
    }
    if (order.paymentStatus === "pending" || order.paymentStatus === "offline_due") {
      summary.awaitingPaymentMinor += order.totalMinor;
      continue;
    }
    if (order.paymentStatus !== "paid") continue;

    summary.totalPaidMinor += order.totalMinor;
    if (ONLINE_METHODS.has(order.paymentMethod)) {
      summary.settledOnlineMinor += order.totalMinor;
    } else {
      summary.collectedOfflineMinor += order.totalMinor;
    }
  }

  return summary;
}

/** Flat processing fee per payout, in minor units. */
export function payoutFeeMinor(currency: CurrencyCode): number {
  return currency === "XOF" ? 500 : 100;
}

/** Minimum payout amount, in minor units. */
export function minimumPayoutMinor(currency: CurrencyCode): number {
  return currency === "XOF" ? 5000 : 5000;
}

/** Converts a major-unit user input ("31.20") to minor units for a currency. */
export function toMinorUnits(value: string, currency: CurrencyCode): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(currency === "XOF" ? parsed : parsed * 100);
}

export type PayoutRecord = {
  amountMinor: number;
  feeMinor: number;
  status: "requested" | "approved" | "rejected" | "paid";
};

export type PayoutValidation =
  | { ok: true; amountMinor: number; feeMinor: number; receivesMinor: number }
  | { ok: false; error: string };

/**
 * Retained so the existing payout_requests rows, the operator screen and any
 * future disbursement work keep a single validation rule. It is not reachable
 * from the seller UI today: requesting a payout is disabled while SnapDuka
 * holds no seller funds.
 */
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
  return {
    ok: true,
    amountMinor,
    feeMinor: fee,
    receivesMinor: amountMinor - fee,
  };
}
