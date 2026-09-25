import type { CurrencyCode } from "@snapduka/core";

/**
 * The creator's SnapDuka wallet, as read back from the ledger.
 *
 * Only commissions on orders SnapDuka actually captured (and whose seller is in
 * the `creator_ledger_payouts` rollout) reach the wallet; everything else is
 * still paid by the shop and only recorded. These helpers turn the two SQL
 * aggregates — `creator_wallet_balances()` and
 * `creator_commission_settlement_totals()` — into the shapes the screens need,
 * without ever summing rows in JavaScript (db.max_rows would truncate that).
 */

/** One row of `creator_wallet_balances()`. */
export type CreatorWalletRow = {
  currency: string;
  pending_minor: number;
  available_minor: number;
  reserved_minor: number;
  in_arrears: boolean;
};

export type CreatorWallet = {
  currency: CurrencyCode;
  pendingMinor: number;
  availableMinor: number;
  reservedMinor: number;
  inArrears: boolean;
};

/**
 * One wallet per currency, largest balance first, and only currencies with
 * something in them — an account that has been drawn to zero on every side is
 * history, not a balance worth a tile.
 */
export function parseCreatorWallets(rows: CreatorWalletRow[] | null | undefined): CreatorWallet[] {
  return (rows ?? [])
    .map((row) => ({
      currency: row.currency as CurrencyCode,
      pendingMinor: Number(row.pending_minor ?? 0),
      availableMinor: Number(row.available_minor ?? 0),
      reservedMinor: Number(row.reserved_minor ?? 0),
      inArrears: Boolean(row.in_arrears),
    }))
    .filter((wallet) => wallet.pendingMinor !== 0 || wallet.availableMinor !== 0 || wallet.reservedMinor !== 0)
    .sort(
      (a, b) =>
        b.availableMinor + b.pendingMinor - (a.availableMinor + a.pendingMinor) ||
        a.currency.localeCompare(b.currency),
    );
}

/** One row of `creator_commission_settlement_totals()`. */
export type SettlementTotalsRow = {
  creator_id: string;
  currency: string;
  settlement: string;
  pending_minor: number;
  payable_minor: number;
  paid_minor: number;
  reversed_minor: number;
  clawed_back_minor: number;
  commission_count: number;
};

export type SettlementSplit = {
  /** Paid by SnapDuka into the creator's wallet, out of the seller's settlement. */
  viaSnapDuka: { pendingMinor: number; paidMinor: number; count: number };
  /** Paid by the shop off-platform and recorded (the original flow). */
  recorded: { pendingMinor: number; payableMinor: number; paidMinor: number; count: number };
};

/**
 * Splits commission totals for one creator and currency by how they settle.
 * Rows for other creators or currencies are ignored, so a seller page can pass
 * the whole result of an unfiltered call.
 */
export function splitBySettlement(
  rows: SettlementTotalsRow[] | null | undefined,
  input: { creatorId?: string; currency: CurrencyCode },
): SettlementSplit {
  const split: SettlementSplit = {
    viaSnapDuka: { pendingMinor: 0, paidMinor: 0, count: 0 },
    recorded: { pendingMinor: 0, payableMinor: 0, paidMinor: 0, count: 0 },
  };
  for (const row of rows ?? []) {
    if (row.currency !== input.currency) continue;
    if (input.creatorId && row.creator_id !== input.creatorId) continue;
    if (row.settlement === "ledger") {
      split.viaSnapDuka.pendingMinor += Number(row.pending_minor ?? 0);
      split.viaSnapDuka.paidMinor += Number(row.paid_minor ?? 0);
      split.viaSnapDuka.count += Number(row.commission_count ?? 0);
    } else {
      split.recorded.pendingMinor += Number(row.pending_minor ?? 0);
      split.recorded.payableMinor += Number(row.payable_minor ?? 0);
      split.recorded.paidMinor += Number(row.paid_minor ?? 0);
      split.recorded.count += Number(row.commission_count ?? 0);
    }
  }
  return split;
}

export type WithdrawBlocker = "paused" | "no_destination" | "cooling_off" | "in_flight" | "below_minimum";

/**
 * Why a creator cannot be offered the withdraw form, or null when they can.
 * The database (request_creator_payout) decides for real under a lock; this
 * only avoids offering an action that cannot succeed. Checked in the order the
 * creator would have to fix them.
 */
export function creatorWithdrawBlocker(input: {
  payoutsEnabled: boolean;
  hasDestination: boolean;
  coolingOff: boolean;
  hasOpenWithdrawal: boolean;
  availableMinor: number;
  minimumMinor: number;
  feeMinor: number;
}): WithdrawBlocker | null {
  if (!input.payoutsEnabled) return "paused";
  if (!input.hasDestination) return "no_destination";
  if (input.coolingOff) return "cooling_off";
  if (input.hasOpenWithdrawal) return "in_flight";
  // The amount must clear both the minimum and the fee, or the RPC refuses it.
  if (input.availableMinor < Math.max(input.minimumMinor, input.feeMinor + 1)) return "below_minimum";
  return null;
}

/**
 * Statuses that count as "a withdrawal in progress" — the same list
 * request_creator_payout refuses a second request on.
 */
export const OPEN_WITHDRAWAL_STATUSES = ["requested", "approved", "processing"] as const;
