import { describe, expect, it } from "vitest";

import { summariseOverview } from "./overview-metrics";

describe("summariseOverview", () => {
  it("reports GMV and counts well past db.max_rows, because they come from SQL", () => {
    // 4,200 paid orders is four pages of the old unbounded select; the old
    // page would have summed at most 1,000 of them.
    const metrics = summariseOverview(
      [{ currency: "GHS", orders: "5000", paid_orders: "4200", gmv_minor: "84000000" }],
      [],
    );
    expect(metrics.gmvByCurrency).toEqual({ GHS: 84_000_000 });
    expect(metrics.orders30d).toBe(5000);
    expect(metrics.paidShare).toBe(84);
  });

  it("never adds GMV across currencies and picks the largest market as primary", () => {
    const metrics = summariseOverview(
      [
        { currency: "GHS", orders: 10, paid_orders: 5, gmv_minor: 50_000 },
        { currency: "NGN", orders: 20, paid_orders: 10, gmv_minor: 900_000 },
        { currency: "XOF", orders: 3, paid_orders: 0, gmv_minor: 0 },
      ],
      [],
    );
    expect(metrics.primaryCurrency).toBe("NGN");
    expect(metrics.markets).toEqual(["NGN", "GHS"]);
    expect(metrics.gmvByCurrency.GHS).toBe(50_000);
    expect(metrics.orders30d).toBe(33);
    expect(metrics.paidShare).toBe(45);
  });

  it("counts every pending payout, not just the five listed, and keeps money per currency", () => {
    const metrics = summariseOverview(
      [{ currency: "GHS", orders: 1, paid_orders: 1, gmv_minor: 100 }],
      [
        { currency: "GHS", requests: "37", amount_minor: "1200000" },
        { currency: "NGN", requests: "4", amount_minor: "800000" },
      ],
    );
    expect(metrics.pendingPayoutCount).toBe(41);
    expect(metrics.pendingPayoutTotal).toBe(1_200_000);
    expect(metrics.pendingPayoutCurrency).toBe("GHS");
  });

  it("is quiet on an empty platform", () => {
    const metrics = summariseOverview([], []);
    expect(metrics).toMatchObject({
      markets: [],
      primaryCurrency: "GHS",
      orders30d: 0,
      paidShare: 0,
      pendingPayoutCount: 0,
      pendingPayoutTotal: 0,
      pendingPayoutCurrency: "GHS",
    });
  });
});
