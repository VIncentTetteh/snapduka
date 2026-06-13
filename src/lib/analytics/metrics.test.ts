import { describe, expect, it } from "vitest";

import { calculateCommerceMetrics } from "@/lib/analytics/metrics";

describe("calculateCommerceMetrics", () => {
  it("uses completed orders as the north-star definition", () => {
    expect(calculateCommerceMetrics({
      visits: 100, productViews: 70, checkoutStarts: 20,
      orders: [{ status: "pending", paymentStatus: "unpaid", fulfillmentStatus: "unconfirmed" }, { status: "completed", paymentStatus: "paid", fulfillmentStatus: "fulfilled" }],
    })).toEqual({
      visits: 100, productViews: 70, checkoutStarts: 20, placedOrders: 2,
      completedOrders: 1, conversionRate: 0.01, paymentSuccessRate: 0.5, fulfillmentCompletionRate: 0.5,
    });
  });
});
