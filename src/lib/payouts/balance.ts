/**
 * Earnings and payout arithmetic lives in @snapduka/core so the seller app
 * shows the same figures as the dashboard. The reasoning behind each rule —
 * particularly why `summariseEarnings` is not a wallet balance, and why
 * `validatePayoutRequest` must not gain a caller — is documented there.
 *
 * This module remains the web-side import path.
 */
export {
  earningsForCurrency,
  minimumPayoutMinor,
  payoutFeeMinor,
  summariseEarnings,
  toMinorUnits,
  validatePayoutRequest,
  type EarningsOrder,
  type EarningsRow,
  type EarningsSummary,
  type PayoutRecord,
  type PayoutValidation,
} from "@snapduka/core";
