/**
 * Seller-facing wording and arithmetic for stock financing, kept pure so the
 * web page, the mobile API and tests all say the same thing. The authoritative
 * numbers always come from the offer row; nothing here prices anything.
 */

/** Why a seller does not qualify, in words they can act on. */
export const FINANCING_REASON_COPY: Readonly<Record<string, string>> = {
  market_not_available: "Capital is not available in your country yet.",
  account_not_active: "Your shop needs to be active.",
  not_on_ledger: "Your payments need to be settled through your SnapDuka balance.",
  account_too_new: "Your shop needs a longer selling history.",
  not_verified: "Verify your identity first.",
  trust_tier: "Build your trust score: fulfil orders quickly and keep refunds low.",
  sales_too_low: "Your online sales over the last 90 days are below the minimum.",
  too_few_orders: "You need more paid online orders in the last 90 days.",
  refund_rate: "Your refund rate is above the limit.",
  chargeback_rate: "Your card chargeback rate is above the limit.",
  offer_below_minimum: "Your sales would support an advance below the minimum amount.",
  active_advance: "You already have an advance being repaid.",
  prior_default: "A previous advance was not repaid.",
};

export function financingReasonCopy(reason: string): string {
  return FINANCING_REASON_COPY[reason] ?? "You do not qualify yet.";
}

/** "15%" for 1500 bps; one decimal place only when needed ("7.5%"). */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/**
 * What one release of `releaseMinor` repays, as the sweep computes it
 * (floor, never more than is still owed).
 */
export function sweepForRelease(releaseMinor: number, sweepBps: number, owedMinor: number): number {
  if (releaseMinor <= 0 || owedMinor <= 0) return 0;
  return Math.min(Math.floor((releaseMinor * sweepBps) / 10_000), owedMinor);
}

export function repaymentProgress(advance: { sweptMinor: number; totalRepayableMinor: number }): {
  repaidMinor: number;
  remainingMinor: number;
  percent: number;
} {
  const repaid = Math.min(Math.max(advance.sweptMinor, 0), advance.totalRepayableMinor);
  const remaining = advance.totalRepayableMinor - repaid;
  const percent = advance.totalRepayableMinor > 0 ? Math.floor((repaid * 100) / advance.totalRepayableMinor) : 0;
  return { repaidMinor: repaid, remainingMinor: remaining, percent };
}

/** The version of the terms text below. Must equal financing_policies.terms_version to accept. */
export const FINANCING_TERMS_VERSION = "v1";

/**
 * The terms the seller confirms. Plain words, the exact numbers, and the two
 * facts people get wrong about revenue-based financing: the fee does not grow
 * with time, and repayment is a share of sales, not a fixed instalment.
 */
export function financingTermsLines(input: {
  principal: string;
  fee: string;
  total: string;
  sweepPercent: string;
}): string[] {
  return [
    `You receive ${input.principal} in your SnapDuka balance, funded by our licensed lending partner.`,
    `You repay ${input.total} in total: the ${input.principal} plus a fixed fee of ${input.fee}. The fee does not grow over time and there is no interest.`,
    `Repayment is automatic: ${input.sweepPercent} of each sale that becomes withdrawable goes towards it until the ${input.total} is repaid. If you sell less, you repay more slowly.`,
    "If your available balance is empty when a sale clears, that share is skipped rather than taken later.",
    "The advance is between you and the lending partner. If you stop selling for a long time the partner may contact you to agree how to repay.",
  ];
}
