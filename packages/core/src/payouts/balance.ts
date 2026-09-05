import type { CurrencyCode } from "../countries/types";

/**
 * Seller earnings by payment method — NOT a wallet balance.
 *
 * Read this alongside `settlement_mode` (country_configs), because what these
 * numbers mean depends on it:
 *
 *   * `subaccount` (legacy): Paystack splits at charge time into the seller's
 *     own subaccount and settles it to their bank directly. SnapDuka never
 *     holds the money, so `settledOnlineMinor` is money the seller already has.
 *   * `ledger`: the full amount lands in SnapDuka's main account and the seller
 *     is credited in the double-entry ledger. Their real, withdrawable position
 *     is `seller_wallet_balance()`, not anything in this file.
 *
 * Offline orders (cash on delivery, pay on pickup, seller arranged) are handed
 * to the seller directly under either mode, so `collectedOfflineMinor` is
 * always money already in their hand and never withdrawable.
 *
 * This module replaced `calculateAvailableBalance`, which summed the GROSS
 * total of paid orders and offered it as withdrawable next to a "Request a
 * payout" button — money the seller had already received, against a payout rail
 * that did not exist. On the demo shop it read GH₵11,422.75.
 *
 * Nothing here nets off Paystack's split, deliberately. Under `ledger` the fee
 * is applied at capture and recorded in the ledger with the rate snapshotted on
 * order_settlements; deriving a second net figure here would be a duplicate
 * source of truth for the same money.
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

/** One row of `seller_earnings_summary()`. */
export type EarningsRow = {
  currency: string;
  settled_online_minor: number;
  collected_offline_minor: number;
  awaiting_payment_minor: number;
  refunded_minor: number;
  total_paid_minor: number;
};

const EMPTY_EARNINGS: EarningsSummary = {
  settledOnlineMinor: 0,
  collectedOfflineMinor: 0,
  awaitingPaymentMinor: 0,
  refundedMinor: 0,
  totalPaidMinor: 0,
};

/**
 * The same summary as `summariseEarnings`, read off the SQL aggregate instead
 * of computed from every order row.
 *
 * `summariseEarnings` needed the whole order history in memory, and PostgREST
 * caps a response at `db.max_rows = 1000` — so past a thousand orders it
 * returned a number that was simply too small, with no error to say so. Both
 * clients now call `seller_earnings_summary()` and pick their own currency:
 * unlike the JavaScript, the aggregate has a currency dimension, so orders in a
 * second currency can no longer be added to this total.
 *
 * A seller with no orders in this currency has no row, which is zero rather
 * than missing data.
 */
export function earningsForCurrency(
  rows: EarningsRow[] | null | undefined,
  currency: string,
): EarningsSummary {
  const row = (rows ?? []).find((candidate) => candidate.currency === currency);
  if (!row) return { ...EMPTY_EARNINGS };
  return {
    settledOnlineMinor: row.settled_online_minor,
    collectedOfflineMinor: row.collected_offline_minor,
    awaitingPaymentMinor: row.awaiting_payment_minor,
    refundedMinor: row.refunded_minor,
    totalPaidMinor: row.total_paid_minor,
  };
}

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
 * Superseded by `request_seller_payout`, which validates under a row lock on
 * the wallet — the lock is the point, because two concurrent withdrawals must
 * not both pass. Thresholds now live in country_configs (minimum_payout_minor,
 * payout_fee_minor), so `payoutFeeMinor`/`minimumPayoutMinor` below are
 * fallbacks only.
 *
 * Kept because the operator screen and the existing payout_requests rows still
 * reference the same rules, and having one readable statement of them is worth
 * more than deleting it. Do not add a caller: validation that decides whether
 * money moves belongs in the RPC, not here, or the two will disagree.
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
