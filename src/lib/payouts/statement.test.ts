import { describe, expect, it } from "vitest";

import { buildStatement, sellerAmount } from "./statement";

const entry = (id: string, at: string, kind: string, amount: number, balance: number) => ({
  id,
  created_at: at,
  amount_minor: amount,
  balance_after_minor: balance,
  account: { kind },
  transaction: { kind: "hold_release", reason: "Hold period elapsed", orders: { public_reference: "SD-1" } },
});

describe("wallet statement", () => {
  it("shows money in as positive, the way a bank statement does", () => {
    expect(sellerAmount({ amount_minor: -9300 })).toBe(9300);
  });

  it("derives opening and closing balances per account, in time order", () => {
    const { rows, summary } = buildStatement([
      entry("b", "2026-09-02T10:00:00Z", "seller_available", 5000, 4300), // withdrawal of 5000
      entry("a", "2026-09-01T10:00:00Z", "seller_available", -9300, 9300), // release in
    ]);
    expect(rows.map((row) => row[5])).toEqual([9300, -5000]);
    expect(summary).toEqual([{ account: "Available", openingMinor: 0, closingMinor: 4300 }]);
  });
});
