import { describe, expect, it } from "vitest";

import {
  creatorWithdrawBlocker,
  parseCreatorWallets,
  splitBySettlement,
  type SettlementTotalsRow,
} from "./wallet";

describe("parseCreatorWallets", () => {
  it("keeps currencies apart and orders the largest balance first", () => {
    const wallets = parseCreatorWallets([
      { currency: "NGN", pending_minor: 100, available_minor: 0, reserved_minor: 0, in_arrears: false },
      { currency: "GHS", pending_minor: 500, available_minor: 2500, reserved_minor: 0, in_arrears: false },
    ]);
    expect(wallets.map((w) => w.currency)).toEqual(["GHS", "NGN"]);
    expect(wallets[0]).toEqual({
      currency: "GHS",
      pendingMinor: 500,
      availableMinor: 2500,
      reservedMinor: 0,
      inArrears: false,
    });
  });

  it("drops a currency that has been drawn to zero on every side", () => {
    expect(
      parseCreatorWallets([
        { currency: "GHS", pending_minor: 0, available_minor: 0, reserved_minor: 0, in_arrears: false },
      ]),
    ).toEqual([]);
  });

  it("keeps a negative balance, because the debt is what the creator needs to see", () => {
    const [wallet] = parseCreatorWallets([
      { currency: "GHS", pending_minor: 0, available_minor: -600, reserved_minor: 0, in_arrears: true },
    ]);
    expect(wallet).toMatchObject({ availableMinor: -600, inArrears: true });
  });

  it("treats a missing result as no wallet", () => {
    expect(parseCreatorWallets(null)).toEqual([]);
  });
});

describe("splitBySettlement", () => {
  const row = (overrides: Partial<SettlementTotalsRow>): SettlementTotalsRow => ({
    creator_id: "c1",
    currency: "GHS",
    settlement: "manual",
    pending_minor: 0,
    payable_minor: 0,
    paid_minor: 0,
    reversed_minor: 0,
    clawed_back_minor: 0,
    commission_count: 0,
    ...overrides,
  });

  it("separates what SnapDuka paid from what the shop recorded", () => {
    const split = splitBySettlement(
      [
        row({ settlement: "ledger", pending_minor: 1000, paid_minor: 4000, commission_count: 3 }),
        row({ settlement: "manual", pending_minor: 200, payable_minor: 300, paid_minor: 900, commission_count: 4 }),
      ],
      { currency: "GHS" },
    );
    expect(split.viaSnapDuka).toEqual({ pendingMinor: 1000, paidMinor: 4000, count: 3 });
    expect(split.recorded).toEqual({ pendingMinor: 200, payableMinor: 300, paidMinor: 900, count: 4 });
  });

  it("ignores other currencies and other creators", () => {
    const split = splitBySettlement(
      [
        row({ settlement: "ledger", paid_minor: 4000 }),
        row({ settlement: "ledger", currency: "NGN", paid_minor: 99999 }),
        row({ settlement: "ledger", creator_id: "c2", paid_minor: 77777 }),
      ],
      { currency: "GHS", creatorId: "c1" },
    );
    expect(split.viaSnapDuka.paidMinor).toBe(4000);
  });
});

describe("creatorWithdrawBlocker", () => {
  const ready = {
    payoutsEnabled: true,
    hasDestination: true,
    coolingOff: false,
    hasOpenWithdrawal: false,
    availableMinor: 10000,
    minimumMinor: 5000,
    feeMinor: 100,
  };

  it("offers the form when everything is in place", () => {
    expect(creatorWithdrawBlocker(ready)).toBeNull();
  });

  it.each([
    [{ payoutsEnabled: false }, "paused"],
    [{ hasDestination: false }, "no_destination"],
    [{ coolingOff: true }, "cooling_off"],
    [{ hasOpenWithdrawal: true }, "in_flight"],
    [{ availableMinor: 4999 }, "below_minimum"],
  ] as const)("refuses when %o", (override, reason) => {
    expect(creatorWithdrawBlocker({ ...ready, ...override })).toBe(reason);
  });

  it("requires the balance to clear the fee even when the minimum is lower", () => {
    expect(creatorWithdrawBlocker({ ...ready, minimumMinor: 50, feeMinor: 100, availableMinor: 100 })).toBe(
      "below_minimum",
    );
  });
});
