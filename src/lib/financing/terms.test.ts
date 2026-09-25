import { describe, expect, it } from "vitest";

import {
  FINANCING_REASON_COPY,
  financingReasonCopy,
  financingTermsLines,
  formatBps,
  repaymentProgress,
  sweepForRelease,
} from "./terms";

describe("financing terms", () => {
  it("has seller-facing copy for every reason financing_eligibility can return", () => {
    // Keep in step with the reasons in 202609250221_stock_financing.sql.
    const sqlReasons = [
      "market_not_available", "account_not_active", "not_on_ledger", "account_too_new", "not_verified",
      "trust_tier", "sales_too_low", "too_few_orders", "refund_rate", "chargeback_rate",
      "offer_below_minimum", "active_advance", "prior_default",
    ];
    for (const reason of sqlReasons) expect(FINANCING_REASON_COPY[reason]).toBeTruthy();
    expect(financingReasonCopy("something_new")).toBe("You do not qualify yet.");
  });

  it("formats basis points as percentages", () => {
    expect(formatBps(1500)).toBe("15%");
    expect(formatBps(750)).toBe("7.5%");
  });

  it("sweeps the same way the SQL does: floor, capped at what is owed", () => {
    expect(sweepForRelease(18_600, 5_000, 31_800)).toBe(9_300);
    expect(sweepForRelease(93_000, 5_000, 18_900)).toBe(18_900);
    expect(sweepForRelease(999, 1_500, 10_000)).toBe(149);
    expect(sweepForRelease(0, 1_500, 10_000)).toBe(0);
    expect(sweepForRelease(10_000, 1_500, 0)).toBe(0);
  });

  it("reports repayment progress without ever exceeding the total", () => {
    expect(repaymentProgress({ sweptMinor: 12_900, totalRepayableMinor: 31_800 })).toEqual({
      repaidMinor: 12_900,
      remainingMinor: 18_900,
      percent: 40,
    });
    expect(repaymentProgress({ sweptMinor: 40_000, totalRepayableMinor: 31_800 }).remainingMinor).toBe(0);
  });

  it("states the fee is fixed and repayment is a share of sales", () => {
    const lines = financingTermsLines({ principal: "GH₵300", fee: "GH₵18", total: "GH₵318", sweepPercent: "15%" });
    expect(lines.join(" ")).toContain("fixed fee of GH₵18");
    expect(lines.join(" ")).toContain("15% of each sale");
    expect(lines.join(" ")).toContain("no interest");
  });
});
