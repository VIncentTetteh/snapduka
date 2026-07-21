import { describe, expect, test, it } from "vitest";
import { advancedCommerceMetrics, productProfitSummaries } from "./advanced";
describe("advanced analytics", () => {
  test("calculates AOV, repeat rate and funnel rates", () => {
    expect(advancedCommerceMetrics({ visits: 100, checkouts: 20, orders: [{ customerId: "a", totalMinor: 1000 }, { customerId: "a", totalMinor: 3000 }, { customerId: "b", totalMinor: 2000 }] })).toEqual({ checkoutRate: 0.2, orderRate: 0.03, averageOrderMinor: 2000, repeatBuyerRate: 0.5 });
  });
});

describe("productProfitSummaries", () => {
  it("returns an empty array for no lines", () => {
    expect(productProfitSummaries([])).toEqual([]);
  });

  it("sums units, revenue, and cost across multiple lines for the same product", () => {
    const result = productProfitSummaries([
      { productId: "p1", productName: "Rice", quantity: 2, lineTotalMinor: 20000, unitCostMinor: 5000 },
      { productId: "p1", productName: "Rice", quantity: 1, lineTotalMinor: 10000, unitCostMinor: 5000 },
    ]);
    expect(result).toEqual([
      { productId: "p1", productName: "Rice", unitsSold: 3, revenueMinor: 30000, costMinor: 15000, profitMinor: 15000 },
    ]);
  });

  it("keeps separate products separate", () => {
    const result = productProfitSummaries([
      { productId: "p1", productName: "Rice", quantity: 1, lineTotalMinor: 10000, unitCostMinor: 5000 },
      { productId: "p2", productName: "Beans", quantity: 1, lineTotalMinor: 8000, unitCostMinor: 3000 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("reports costMinor and profitMinor as null when any contributing line has an unknown cost", () => {
    const result = productProfitSummaries([
      { productId: "p1", productName: "Rice", quantity: 1, lineTotalMinor: 10000, unitCostMinor: 5000 },
      { productId: "p1", productName: "Rice", quantity: 1, lineTotalMinor: 10000, unitCostMinor: null },
    ]);
    expect(result[0].costMinor).toBeNull();
    expect(result[0].profitMinor).toBeNull();
    expect(result[0].unitsSold).toBe(2);
    expect(result[0].revenueMinor).toBe(20000);
  });
});
