import type { CurrencyCode } from "@/lib/countries/types";

/**
 * Creator commission arithmetic.
 *
 * Shaped like src/lib/payouts/balance.ts: pure, minor units throughout, no
 * I/O. The database holds the same formula as a check constraint on
 * creator_commissions, so any drift here fails loudly at write time rather
 * than quietly paying the wrong amount.
 */

export type CommissionStatus = "pending" | "payable" | "paid" | "reversed" | "void";

/** Hard ceiling shared with the rate_bps check constraint. */
export const MAX_RATE_BPS = 5000;
export const DEFAULT_HOLD_DAYS = 14;

/**
 * Rounds DOWN, deliberately. A half-pesewa rounded up on every order is money
 * the seller never agreed to, and the shortfall per order is at most one minor
 * unit. Mirrors `floor(basis_minor * rate_bps / 10000)` in the DB constraint.
 */
export function computeCommissionMinor(basisMinor: number, rateBps: number): number {
  if (!Number.isFinite(basisMinor) || !Number.isFinite(rateBps)) return 0;
  if (basisMinor <= 0 || rateBps <= 0) return 0;
  const clamped = Math.min(rateBps, MAX_RATE_BPS);
  return Math.floor((basisMinor * clamped) / 10_000);
}

/**
 * Commission is earned on goods sold, never on the courier fee — a creator
 * taking a cut of delivery would make distant orders lose the seller money.
 */
export function commissionBasisMinor(input: { subtotalMinor: number; discountMinor: number }): number {
  return Math.max(0, input.subtotalMinor - input.discountMinor);
}

/** When a commission stops being held and becomes payable. */
export function payableAt(paidAt: Date, holdDays: number): Date {
  const days = Number.isFinite(holdDays) ? Math.max(0, Math.min(holdDays, 90)) : DEFAULT_HOLD_DAYS;
  return new Date(paidAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Reduces the basis in proportion to what was refunded.
 *
 * A refund exceeding the order total (over-refund, or a total of zero) collapses
 * the basis to zero rather than producing a negative commission.
 */
export function proratedBasisMinor(input: {
  basisMinor: number;
  refundedMinor: number;
  orderTotalMinor: number;
}): number {
  const { basisMinor, refundedMinor, orderTotalMinor } = input;
  if (basisMinor <= 0 || orderTotalMinor <= 0) return 0;
  if (refundedMinor <= 0) return basisMinor;
  if (refundedMinor >= orderTotalMinor) return 0;
  return Math.floor((basisMinor * (orderTotalMinor - refundedMinor)) / orderTotalMinor);
}

export type CreatorBalance = {
  /** Still inside the hold window. */
  pendingMinor: number;
  /** Held long enough, not yet paid. */
  payableMinor: number;
  paidMinor: number;
  reversedMinor: number;
  /** What the seller owes right now, after netting off adjustments. */
  owedNowMinor: number;
  /**
   * Negative adjustments that outstrip the current payable balance — usually a
   * refund landing after the commission was already paid. Carried rather than
   * discarded so it nets off the next payable commission instead of vanishing.
   */
  carryOverMinor: number;
};

/**
 * Rolls a creator's ledger into the four numbers both sides need to agree on.
 * Adjustments are signed and typically negative.
 */
export function calculateCreatorBalance(input: {
  commissions: { status: CommissionStatus; amountMinor: number }[];
  adjustments?: { deltaMinor: number }[];
}): CreatorBalance {
  const sumBy = (status: CommissionStatus) =>
    input.commissions
      .filter((commission) => commission.status === status)
      .reduce((total, commission) => total + commission.amountMinor, 0);

  const pendingMinor = sumBy("pending");
  const payableMinor = sumBy("payable");
  const paidMinor = sumBy("paid");
  const reversedMinor = sumBy("reversed");

  const adjustmentTotal = (input.adjustments ?? []).reduce(
    (total, adjustment) => total + adjustment.deltaMinor,
    0,
  );
  const net = payableMinor + adjustmentTotal;

  return {
    pendingMinor,
    payableMinor,
    paidMinor,
    reversedMinor,
    owedNowMinor: Math.max(0, net),
    carryOverMinor: net < 0 ? net : 0,
  };
}

/** "12.5%" from 1250 bps, without trailing zeroes on whole percentages. */
export function formatRate(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}

export function minimumPayableMinor(currency: CurrencyCode): number {
  // XOF has no minor unit in practice, so the same nominal floor would be 100x.
  return currency === "XOF" ? 500 : 100;
}
