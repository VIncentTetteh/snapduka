/**
 * Commission arithmetic lives in @snapduka/core so the seller app and the
 * dashboard compute the same amounts. The reasoning — why rounding is DOWN,
 * why delivery is excluded from the basis — is documented there, alongside the
 * check constraint it mirrors.
 *
 * This module remains the web-side import path.
 */
export {
  calculateCreatorBalance,
  calculateCreatorBalancesByCurrency,
  commissionBasisMinor,
  computeCommissionMinor,
  DEFAULT_HOLD_DAYS,
  formatRate,
  MAX_RATE_BPS,
  minimumPayableMinor,
  payableAt,
  proratedBasisMinor,
  type CommissionStatus,
  type CreatorBalance,
} from "@snapduka/core";
