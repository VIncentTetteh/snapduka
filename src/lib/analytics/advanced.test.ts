import { describe, expect, test } from "vitest";
import { advancedCommerceMetrics } from "./advanced";
describe("advanced analytics", () => {
  test("calculates AOV, repeat rate and funnel rates", () => {
    expect(advancedCommerceMetrics({ visits: 100, checkouts: 20, orders: [{ customerId: "a", totalMinor: 1000 }, { customerId: "a", totalMinor: 3000 }, { customerId: "b", totalMinor: 2000 }] })).toEqual({ checkoutRate: 0.2, orderRate: 0.03, averageOrderMinor: 2000, repeatBuyerRate: 0.5 });
  });
});
