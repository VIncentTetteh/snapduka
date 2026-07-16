import { describe, expect, it } from "vitest";

import {
  calculateAvailableBalance,
  minimumPayoutMinor,
  payoutFeeMinor,
  toMinorUnits,
  validatePayoutRequest,
} from "./balance";

describe("calculateAvailableBalance", () => {
  it("subtracts committed payouts from paid revenue", () => {
    expect(
      calculateAvailableBalance({
        paidOrdersTotalMinor: 1_248_000,
        payouts: [
          { amountMinor: 250_000, feeMinor: 100, status: "paid" },
          { amountMinor: 100_000, feeMinor: 100, status: "requested" },
        ],
      }),
    ).toBe(898_000);
  });

  it("releases rejected payout amounts back to the balance", () => {
    expect(
      calculateAvailableBalance({
        paidOrdersTotalMinor: 500_000,
        payouts: [{ amountMinor: 200_000, feeMinor: 100, status: "rejected" }],
      }),
    ).toBe(500_000);
  });

  it("never returns a negative balance", () => {
    expect(
      calculateAvailableBalance({
        paidOrdersTotalMinor: 100,
        payouts: [{ amountMinor: 500, feeMinor: 100, status: "paid" }],
      }),
    ).toBe(0);
  });
});

describe("validatePayoutRequest", () => {
  it("accepts a valid amount and computes the fee", () => {
    const result = validatePayoutRequest({
      amountMinor: 312_000,
      availableMinor: 312_000,
      currency: "GHS",
    });
    expect(result).toEqual({
      ok: true,
      amountMinor: 312_000,
      feeMinor: 100,
      receivesMinor: 311_900,
    });
  });

  it("rejects amounts over the available balance", () => {
    const result = validatePayoutRequest({
      amountMinor: 10_000,
      availableMinor: 9_000,
      currency: "GHS",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects amounts below the minimum", () => {
    const result = validatePayoutRequest({
      amountMinor: minimumPayoutMinor("NGN") - 1,
      availableMinor: 1_000_000,
      currency: "NGN",
    });
    expect(result.ok).toBe(false);
  });
});

describe("money helpers", () => {
  it("uses whole units for XOF", () => {
    expect(toMinorUnits("12000", "XOF")).toBe(12000);
    expect(payoutFeeMinor("XOF")).toBe(500);
  });

  it("converts decimal major units to minor for GHS", () => {
    expect(toMinorUnits("31.20", "GHS")).toBe(3120);
  });

  it("returns null for invalid input", () => {
    expect(toMinorUnits("abc", "GHS")).toBeNull();
    expect(toMinorUnits("-5", "GHS")).toBeNull();
  });
});
