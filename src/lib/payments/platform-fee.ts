/**
 * SnapDuka's share of an online transaction.
 *
 * Sent to Paystack as a subaccount's `percentage_charge`. What that field means
 * was unconfirmed for a long time and is now settled against a live split:
 *
 *   amount 12000  ->  subaccount 10800 | integration 966 | paystack 234
 *                     fees_split params: percentage_charge "10"
 *
 * 10800 + 966 + 234 = 12000. So the charge is SnapDuka's cut, the seller's
 * subaccount receives the remainder, and Paystack's own processing fee comes
 * out of SnapDuka's share — not the seller's. Raising the fee lowers seller
 * income; lowering it raises seller income and shrinks SnapDuka's margin.
 *
 * Stored per country in country_configs.platform_fee_bps, in basis points, to
 * match commission_rate_bps and the rest of the money handling. Percent is only
 * used at the Paystack boundary because that is what the API takes.
 *
 * No I/O here, following src/lib/payouts/balance.ts.
 */

/** Used when a country has no row — the same value the migration seeds. */
export const DEFAULT_PLATFORM_FEE_BPS = 700;

/**
 * Bounds mirror country_configs_platform_fee_bps_check.
 *
 * The floor is the one that matters. Paystack's fee is deducted from SnapDuka's
 * share, so a rate at or below Paystack's effective rate (~1.95% in Ghana)
 * means SnapDuka pays to process each sale. 100 bps still allows a deliberate
 * promotional rate while making an accidental 0 impossible.
 */
export const MIN_PLATFORM_FEE_BPS = 100;
export const MAX_PLATFORM_FEE_BPS = 3000;

/** True when SnapDuka's share would not cover a typical Paystack fee. */
export const PAYSTACK_TYPICAL_FEE_BPS = 195;

export function isPlatformFeeBps(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_PLATFORM_FEE_BPS &&
    value <= MAX_PLATFORM_FEE_BPS
  );
}

/**
 * Basis points to the percent Paystack expects.
 *
 * Paystack accepts decimals, so 725 bps is sent as 7.25 rather than being
 * rounded to 7 — silently rounding would quietly move real money.
 */
export function feeBpsToPercent(bps: number): number {
  return Math.round(bps) / 100;
}

/** The share the seller keeps, in basis points. */
export function sellerShareBps(feeBps: number): number {
  return 10_000 - feeBps;
}

/** What the seller's subaccount receives on `amountMinor`, before Paystack's fee. */
export function sellerShareMinor(amountMinor: number, feeBps: number): number {
  return Math.round((amountMinor * sellerShareBps(feeBps)) / 10_000);
}

/** SnapDuka's gross share of `amountMinor`, before Paystack deducts its fee. */
export function platformShareMinor(amountMinor: number, feeBps: number): number {
  return amountMinor - sellerShareMinor(amountMinor, feeBps);
}

/** "7%" / "7.25%" — trailing zeroes dropped so the common case reads cleanly. */
export function formatFeeBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

export type PlatformFeeValidation =
  | { ok: true; bps: number; warning?: string }
  | { ok: false; error: string };

/**
 * Validates an operator-entered percentage (e.g. "7", "7.25") for a fee change.
 *
 * A rate that clears the hard floor but not Paystack's fee is allowed with a
 * warning rather than blocked: it is a legitimate promotional choice, and the
 * operator should be told they will be paying to process rather than stopped.
 */
export function validateFeePercent(input: string): PlatformFeeValidation {
  const percent = Number.parseFloat(input.trim());
  if (!Number.isFinite(percent)) {
    return { ok: false, error: "Enter a percentage, for example 7." };
  }
  const bps = Math.round(percent * 100);
  if (bps < MIN_PLATFORM_FEE_BPS) {
    return { ok: false, error: `The lowest allowed fee is ${formatFeeBps(MIN_PLATFORM_FEE_BPS)}.` };
  }
  if (bps > MAX_PLATFORM_FEE_BPS) {
    return { ok: false, error: `The highest allowed fee is ${formatFeeBps(MAX_PLATFORM_FEE_BPS)}.` };
  }
  if (bps <= PAYSTACK_TYPICAL_FEE_BPS) {
    return {
      ok: true,
      bps,
      warning: `At ${formatFeeBps(bps)} your share may not cover Paystack's own fee, so SnapDuka would pay to process these sales.`,
    };
  }
  return { ok: true, bps };
}
