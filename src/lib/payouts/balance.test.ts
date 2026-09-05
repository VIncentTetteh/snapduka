import { describe, expect, it } from "vitest";

import {
  earningsForCurrency,
  minimumPayoutMinor,
  payoutFeeMinor,
  summariseEarnings,
  toMinorUnits,
  validatePayoutRequest,
  type EarningsOrder,
  type EarningsRow,
} from "./balance";

const order = (over: Partial<EarningsOrder>): EarningsOrder => ({
  totalMinor: 10_000,
  paymentMethod: "paystack",
  paymentStatus: "paid",
  ...over,
});

describe("summariseEarnings", () => {
  it("separates money Paystack settles from money the seller collected", () => {
    const summary = summariseEarnings([
      order({ totalMinor: 30_000, paymentMethod: "paystack" }),
      order({ totalMinor: 12_000, paymentMethod: "cash_on_delivery" }),
      order({ totalMinor: 8_000, paymentMethod: "pay_on_pickup" }),
    ]);

    expect(summary.settledOnlineMinor).toBe(30_000);
    expect(summary.collectedOfflineMinor).toBe(20_000);
    expect(summary.totalPaidMinor).toBe(50_000);
  });

  it("keeps unpaid orders out of the paid totals", () => {
    const summary = summariseEarnings([
      order({ totalMinor: 5_000, paymentStatus: "pending" }),
      order({
        totalMinor: 7_000,
        paymentStatus: "offline_due",
        paymentMethod: "cash_on_delivery",
      }),
      order({ totalMinor: 9_000, paymentStatus: "paid" }),
    ]);

    expect(summary.awaitingPaymentMinor).toBe(12_000);
    expect(summary.totalPaidMinor).toBe(9_000);
    expect(summary.settledOnlineMinor).toBe(9_000);
    expect(summary.collectedOfflineMinor).toBe(0);
  });

  it("reports refunds separately instead of folding them into earnings", () => {
    const summary = summariseEarnings([
      order({ totalMinor: 20_000 }),
      order({ totalMinor: 6_000, paymentStatus: "refunded" }),
    ]);

    expect(summary.refundedMinor).toBe(6_000);
    expect(summary.totalPaidMinor).toBe(20_000);
  });

  it("ignores statuses that are neither paid, awaited nor refunded", () => {
    const summary = summariseEarnings([order({ paymentStatus: "failed" })]);

    expect(summary).toEqual({
      settledOnlineMinor: 0,
      collectedOfflineMinor: 0,
      awaitingPaymentMinor: 0,
      refundedMinor: 0,
      totalPaidMinor: 0,
    });
  });

  it("treats an unrecognised payment method as money the seller collected", () => {
    // A new offline method must never be reported as already settled to a bank.
    const summary = summariseEarnings([order({ paymentMethod: "seller_arranged" })]);

    expect(summary.collectedOfflineMinor).toBe(10_000);
    expect(summary.settledOnlineMinor).toBe(0);
  });

  it("returns zeroes for a shop with no orders", () => {
    expect(summariseEarnings([]).totalPaidMinor).toBe(0);
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

/**
 * `summariseEarnings` needed every order in memory, and PostgREST caps a
 * response at db.max_rows = 1000 — so past a thousand orders the all-time
 * earnings figure on the money page was simply too small, with no error to say
 * so. `earningsForCurrency` reads `seller_earnings_summary()` instead.
 */
describe("earningsForCurrency", () => {
  const rows: EarningsRow[] = [
    {
      currency: "GHS",
      settled_online_minor: 12_000,
      collected_offline_minor: 3_000,
      awaiting_payment_minor: 500,
      refunded_minor: 250,
      total_paid_minor: 15_000,
    },
    {
      currency: "NGN",
      settled_online_minor: 900,
      collected_offline_minor: 0,
      awaiting_payment_minor: 0,
      refunded_minor: 0,
      total_paid_minor: 900,
    },
  ];

  it("reads the row for the seller's own currency", () => {
    expect(earningsForCurrency(rows, "GHS")).toEqual({
      settledOnlineMinor: 12_000,
      collectedOfflineMinor: 3_000,
      awaitingPaymentMinor: 500,
      refundedMinor: 250,
      totalPaidMinor: 15_000,
    });
  });

  // The reason the aggregate has a currency dimension at all: summariseEarnings
  // has none, so a second currency was added straight into the total.
  it("does not add another currency's money to the total", () => {
    expect(earningsForCurrency(rows, "GHS").totalPaidMinor).toBe(15_000);
    expect(earningsForCurrency(rows, "NGN").totalPaidMinor).toBe(900);
  });

  it("treats a currency with no orders as zero, not as missing", () => {
    expect(earningsForCurrency(rows, "XOF")).toEqual({
      settledOnlineMinor: 0,
      collectedOfflineMinor: 0,
      awaitingPaymentMinor: 0,
      refundedMinor: 0,
      totalPaidMinor: 0,
    });
  });

  it("survives the RPC returning nothing at all", () => {
    expect(earningsForCurrency(null, "GHS").totalPaidMinor).toBe(0);
    expect(earningsForCurrency(undefined, "GHS").totalPaidMinor).toBe(0);
    expect(earningsForCurrency([], "GHS").totalPaidMinor).toBe(0);
  });

  // The port must not change what the page says. Summarise a set of orders the
  // old way, shape the same figures as the aggregate produces, and require the
  // two to agree.
  it("agrees with summariseEarnings on the same orders", () => {
    const legacy = summariseEarnings([
      order({ totalMinor: 5_000 }),
      order({ totalMinor: 7_000 }),
      order({ totalMinor: 3_000, paymentMethod: "cash_on_delivery" }),
      order({ totalMinor: 500, paymentMethod: "cash_on_delivery", paymentStatus: "offline_due" }),
      order({ totalMinor: 250, paymentStatus: "refunded" }),
    ]);

    // Exactly what seller_earnings_summary() computes over those rows.
    const aggregate: EarningsRow = {
      currency: "GHS",
      settled_online_minor: 12_000,
      collected_offline_minor: 3_000,
      awaiting_payment_minor: 500,
      refunded_minor: 250,
      total_paid_minor: 15_000,
    };

    expect(earningsForCurrency([aggregate], "GHS")).toEqual(legacy);
  });
});
