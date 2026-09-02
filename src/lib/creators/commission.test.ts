import { describe, expect, it } from "vitest";

import {
  calculateCreatorBalance,
  calculateCreatorBalancesByCurrency,
  commissionBasisMinor,
  computeCommissionMinor,
  formatRate,
  payableAt,
  proratedBasisMinor,
} from "./commission";

describe("computeCommissionMinor", () => {
  it("takes the stated percentage of the basis", () => {
    expect(computeCommissionMinor(10_000, 1250)).toBe(1250); // GHS 100.00 @ 12.5%
    expect(computeCommissionMinor(24_000, 1000)).toBe(2400);
    expect(computeCommissionMinor(9_500, 500)).toBe(475);
  });

  // Rounding down is the deliberate choice: rounding up would charge the seller
  // a fraction they never agreed to on every single order.
  it("rounds down at the pesewa rather than up", () => {
    expect(computeCommissionMinor(999, 1250)).toBe(124); // 124.875
    expect(computeCommissionMinor(1, 1)).toBe(0);
    expect(computeCommissionMinor(19_999, 333)).toBe(665); // 665.9667
  });

  it("is zero for a zero basis or zero rate", () => {
    expect(computeCommissionMinor(0, 1250)).toBe(0);
    expect(computeCommissionMinor(10_000, 0)).toBe(0);
  });

  it("never returns a negative amount", () => {
    expect(computeCommissionMinor(-500, 1250)).toBe(0);
    expect(computeCommissionMinor(10_000, -100)).toBe(0);
  });

  it("clamps at the 50% ceiling the schema also enforces", () => {
    expect(computeCommissionMinor(10_000, 5000)).toBe(5000);
    expect(computeCommissionMinor(10_000, 9999)).toBe(5000);
  });

  it("survives non-finite input instead of producing NaN", () => {
    expect(computeCommissionMinor(Number.NaN, 1250)).toBe(0);
    expect(computeCommissionMinor(10_000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("commissionBasisMinor", () => {
  // Delivery is excluded: a cut of the courier fee would make distant orders
  // lose the seller money.
  it("is the subtotal after discount, with delivery excluded entirely", () => {
    expect(commissionBasisMinor({ subtotalMinor: 24_000, discountMinor: 0 })).toBe(24_000);
    expect(commissionBasisMinor({ subtotalMinor: 24_000, discountMinor: 3_600 })).toBe(20_400);
  });

  it("floors at zero when a discount somehow exceeds the subtotal", () => {
    expect(commissionBasisMinor({ subtotalMinor: 1_000, discountMinor: 5_000 })).toBe(0);
  });
});

describe("payableAt", () => {
  const paidAt = new Date("2026-07-29T12:00:00.000Z");

  it("adds the hold window", () => {
    expect(payableAt(paidAt, 14).toISOString()).toBe("2026-08-12T12:00:00.000Z");
    expect(payableAt(paidAt, 0).toISOString()).toBe("2026-07-29T12:00:00.000Z");
  });

  it("clamps to the 0-90 day range the schema allows", () => {
    expect(payableAt(paidAt, 500).toISOString()).toBe(payableAt(paidAt, 90).toISOString());
    expect(payableAt(paidAt, -5).toISOString()).toBe(payableAt(paidAt, 0).toISOString());
  });
});

describe("proratedBasisMinor", () => {
  it("leaves the basis alone when nothing was refunded", () => {
    expect(proratedBasisMinor({ basisMinor: 20_000, refundedMinor: 0, orderTotalMinor: 22_500 })).toBe(20_000);
  });

  it("scales the basis by the unrefunded share", () => {
    // Half the order refunded, so half the commissionable basis remains.
    expect(proratedBasisMinor({ basisMinor: 20_000, refundedMinor: 11_250, orderTotalMinor: 22_500 })).toBe(10_000);
  });

  it("collapses to zero on a full refund", () => {
    expect(proratedBasisMinor({ basisMinor: 20_000, refundedMinor: 22_500, orderTotalMinor: 22_500 })).toBe(0);
  });

  // An over-refund (goodwill top-up, or a correction) must not invert into a
  // negative commission the seller would be owed back twice.
  it("collapses to zero when the refund exceeds the order total", () => {
    expect(proratedBasisMinor({ basisMinor: 20_000, refundedMinor: 30_000, orderTotalMinor: 22_500 })).toBe(0);
  });

  it("handles a zero-total order without dividing by zero", () => {
    expect(proratedBasisMinor({ basisMinor: 0, refundedMinor: 0, orderTotalMinor: 0 })).toBe(0);
  });
});

describe("calculateCreatorBalance", () => {
  it("separates held, payable and paid", () => {
    const balance = calculateCreatorBalance({
      commissions: [
        { status: "pending", amountMinor: 1_200 },
        { status: "pending", amountMinor: 800 },
        { status: "payable", amountMinor: 3_000 },
        { status: "paid", amountMinor: 5_000 },
        { status: "reversed", amountMinor: 400 },
      ],
    });

    expect(balance).toMatchObject({
      pendingMinor: 2_000,
      payableMinor: 3_000,
      paidMinor: 5_000,
      reversedMinor: 400,
      owedNowMinor: 3_000,
      carryOverMinor: 0,
    });
  });

  it("nets a negative adjustment off what is owed now", () => {
    const balance = calculateCreatorBalance({
      commissions: [{ status: "payable", amountMinor: 3_000 }],
      adjustments: [{ deltaMinor: -1_200 }],
    });

    expect(balance.owedNowMinor).toBe(1_800);
    expect(balance.carryOverMinor).toBe(0);
  });

  // A refund landing after the commission was already paid out. The debt must
  // survive as carry-over rather than silently disappearing at zero.
  it("carries a debt forward when adjustments exceed the payable balance", () => {
    const balance = calculateCreatorBalance({
      commissions: [{ status: "payable", amountMinor: 1_000 }],
      adjustments: [{ deltaMinor: -2_500 }],
    });

    expect(balance.owedNowMinor).toBe(0);
    expect(balance.carryOverMinor).toBe(-1_500);
  });

  it("is all zeroes for a creator with no ledger yet", () => {
    expect(calculateCreatorBalance({ commissions: [] })).toMatchObject({
      pendingMinor: 0,
      payableMinor: 0,
      paidMinor: 0,
      owedNowMinor: 0,
      carryOverMinor: 0,
    });
  });
});

describe("formatRate", () => {
  it("reads the way a seller would say it", () => {
    expect(formatRate(1000)).toBe("10%");
    expect(formatRate(1250)).toBe("12.5%");
    expect(formatRate(500)).toBe("5%");
    expect(formatRate(5000)).toBe("50%");
  });
});

// A creator can partner with shops in any of the three supported countries, so
// their ledger genuinely mixes currencies. calculateCreatorBalance has no
// currency dimension, and the portal used to sum a mixed ledger through it and
// label the result with whichever row sorted first.
// Found by /qa on 2026-09-02
describe("calculateCreatorBalancesByCurrency", () => {
  it("keeps cedis and naira apart instead of adding them", () => {
    const balances = calculateCreatorBalancesByCurrency({
      commissions: [
        { status: "payable", amountMinor: 24_000, currency: "GHS" },
        { status: "payable", amountMinor: 500_000, currency: "NGN" },
      ],
    });

    expect(balances.GHS?.owedNowMinor).toBe(24_000);
    expect(balances.NGN?.owedNowMinor).toBe(500_000);
    // The bug this replaces produced a single 524,000.
    expect(balances.GHS?.owedNowMinor).not.toBe(524_000);
  });

  it("keeps XOF separate, where combining is most wrong", () => {
    // XOF has no minor unit: 12,000 XOF is twelve thousand francs, while
    // 12,000 GHS minor units are GH₵120. Summed they are meaningless.
    const balances = calculateCreatorBalancesByCurrency({
      commissions: [
        { status: "payable", amountMinor: 12_000, currency: "XOF" },
        { status: "payable", amountMinor: 12_000, currency: "GHS" },
      ],
    });

    expect(balances.XOF?.owedNowMinor).toBe(12_000);
    expect(balances.GHS?.owedNowMinor).toBe(12_000);
    expect(Object.keys(balances)).toHaveLength(2);
  });

  it("matches calculateCreatorBalance exactly for a single-currency creator", () => {
    const commissions = [
      { status: "payable" as const, amountMinor: 5_000 },
      { status: "pending" as const, amountMinor: 2_500 },
      { status: "paid" as const, amountMinor: 1_000 },
    ];
    const adjustments = [{ deltaMinor: -500 }];

    const grouped = calculateCreatorBalancesByCurrency({
      commissions: commissions.map((c) => ({ ...c, currency: "GHS" as const })),
      adjustments: adjustments.map((a) => ({ ...a, currency: "GHS" as const })),
    });

    expect(grouped.GHS).toEqual(calculateCreatorBalance({ commissions, adjustments }));
    expect(Object.keys(grouped)).toEqual(["GHS"]);
  });

  it("applies an adjustment only within its own currency", () => {
    const balances = calculateCreatorBalancesByCurrency({
      commissions: [
        { status: "payable", amountMinor: 10_000, currency: "GHS" },
        { status: "payable", amountMinor: 10_000, currency: "NGN" },
      ],
      adjustments: [{ deltaMinor: -4_000, currency: "GHS" }],
    });

    expect(balances.GHS?.owedNowMinor).toBe(6_000);
    expect(balances.NGN?.owedNowMinor).toBe(10_000);
  });

  it("still reports a currency whose only row is an adjustment", () => {
    // A reversal can outlive the commission it cancelled; the carry-over has to
    // survive or the creator's next payout silently overpays.
    const balances = calculateCreatorBalancesByCurrency({
      commissions: [],
      adjustments: [{ deltaMinor: -750, currency: "NGN" }],
    });

    expect(balances.NGN?.carryOverMinor).toBe(-750);
    expect(balances.NGN?.owedNowMinor).toBe(0);
  });

  it("returns nothing for an empty ledger", () => {
    expect(calculateCreatorBalancesByCurrency({ commissions: [] })).toEqual({});
  });
});
