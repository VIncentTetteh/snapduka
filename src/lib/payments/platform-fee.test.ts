import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLATFORM_FEE_BPS,
  MAX_PLATFORM_FEE_BPS,
  MIN_PLATFORM_FEE_BPS,
  feeBpsToPercent,
  formatFeeBps,
  isPlatformFeeBps,
  platformShareMinor,
  sellerShareBps,
  sellerShareMinor,
  validateFeePercent,
} from "./platform-fee";

describe("the split, pinned against a real Paystack transaction", () => {
  // amount 12000 -> subaccount 10800 | integration 966 | paystack 234
  // with fees_split params percentage_charge "10". This is the observation that
  // settled which side of percentage_charge receives the cut, so it is pinned
  // here: if this assertion ever changes, seller income changes with it.
  it("gives the seller 100 - fee, matching the observed 10800 of 12000 at 10%", () => {
    expect(sellerShareMinor(12_000, 1_000)).toBe(10_800);
    expect(platformShareMinor(12_000, 1_000)).toBe(1_200);
  });

  it("pays sellers more at the new 7% rate, not less", () => {
    expect(sellerShareMinor(12_000, 700)).toBe(11_160);
    expect(sellerShareMinor(12_000, 700)).toBeGreaterThan(sellerShareMinor(12_000, 1_000));
  });

  it("defaults to 7%", () => {
    expect(DEFAULT_PLATFORM_FEE_BPS).toBe(700);
    expect(sellerShareBps(DEFAULT_PLATFORM_FEE_BPS)).toBe(9_300);
  });

  it("always splits the full amount with nothing lost to rounding", () => {
    for (const amount of [1, 7, 99, 333, 12_345, 1_000_003]) {
      expect(sellerShareMinor(amount, 700) + platformShareMinor(amount, 700)).toBe(amount);
    }
  });
});

describe("feeBpsToPercent", () => {
  it("converts basis points to the percent Paystack expects", () => {
    expect(feeBpsToPercent(700)).toBe(7);
    expect(feeBpsToPercent(1_000)).toBe(10);
  });

  // Paystack accepts decimals, so rounding 7.25 down to 7 would quietly move
  // real money on every transaction.
  it("keeps fractional percentages instead of rounding them away", () => {
    expect(feeBpsToPercent(725)).toBe(7.25);
    expect(feeBpsToPercent(1_950)).toBe(19.5);
  });
});

describe("bounds", () => {
  it("accepts the configured range", () => {
    expect(isPlatformFeeBps(700)).toBe(true);
    expect(isPlatformFeeBps(MIN_PLATFORM_FEE_BPS)).toBe(true);
    expect(isPlatformFeeBps(MAX_PLATFORM_FEE_BPS)).toBe(true);
  });

  it("rejects values the database constraint would reject", () => {
    expect(isPlatformFeeBps(0)).toBe(false);
    expect(isPlatformFeeBps(MIN_PLATFORM_FEE_BPS - 1)).toBe(false);
    expect(isPlatformFeeBps(MAX_PLATFORM_FEE_BPS + 1)).toBe(false);
    expect(isPlatformFeeBps(7.5)).toBe(false);
  });
});

describe("validateFeePercent", () => {
  it("accepts a whole percentage", () => {
    expect(validateFeePercent("7")).toEqual({ ok: true, bps: 700 });
  });

  it("accepts a fractional percentage", () => {
    expect(validateFeePercent("7.25")).toEqual({ ok: true, bps: 725 });
  });

  it("rejects non-numeric input", () => {
    expect(validateFeePercent("seven").ok).toBe(false);
    expect(validateFeePercent("").ok).toBe(false);
  });

  it("rejects a fee that would zero out the seller", () => {
    expect(validateFeePercent("100").ok).toBe(false);
  });

  it("rejects an accidental zero", () => {
    expect(validateFeePercent("0").ok).toBe(false);
  });

  // Paystack's fee is deducted from SnapDuka's share, so a very low rate means
  // SnapDuka pays to process. That is a legitimate promotional choice, so warn
  // rather than block — but never let it pass silently.
  it("warns, without blocking, when the fee will not cover Paystack's own", () => {
    const result = validateFeePercent("1.5");
    expect(result.ok).toBe(true);
    expect(result.ok && result.warning).toMatch(/pay to process/);
  });

  it("does not warn at the new default rate", () => {
    const result = validateFeePercent("7");
    expect(result.ok && result.warning).toBeUndefined();
  });
});

describe("formatFeeBps", () => {
  it("drops trailing zeroes so the common case reads cleanly", () => {
    expect(formatFeeBps(700)).toBe("7%");
    expect(formatFeeBps(725)).toBe("7.25%");
    expect(formatFeeBps(9_300)).toBe("93%");
  });
});
