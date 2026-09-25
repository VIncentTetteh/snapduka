import { describe, expect, it } from "vitest";

import { PROTECT_BUYER_COPY, PROTECT_SELLER_COPY, PROTECT_STATES, protectFeeMinor } from "./index";

const GH = { feeBps: 150, minMinor: 100, capMinor: 2000 };

describe("protectFeeMinor", () => {
  it.each([
    [10000, 150], // 1.5% of GH₵100
    [1000, 100], // floor: GH₵1 minimum
    [500000, 2000], // cap: GH₵20 maximum
    [10033, 150], // floors like SQL integer division, never rounds up
    [0, 100],
  ])("fee on %i is %i (matches public.protect_fee_for)", (amount, fee) => {
    expect(protectFeeMinor(amount, GH)).toBe(fee);
  });

  it("rejects fractional or negative amounts rather than guessing", () => {
    expect(() => protectFeeMinor(10.5, GH)).toThrow(RangeError);
    expect(() => protectFeeMinor(-1, GH)).toThrow(RangeError);
  });
});

describe("copy", () => {
  it("covers every state for both audiences", () => {
    for (const state of PROTECT_STATES) {
      expect(PROTECT_BUYER_COPY[state]).toBeTruthy();
      expect(PROTECT_SELLER_COPY[state]).toBeTruthy();
    }
  });

  it("never tells the seller about the buyer's delivery code value", () => {
    for (const text of Object.values(PROTECT_SELLER_COPY)) expect(text).not.toMatch(/\d{6}/);
  });
});
