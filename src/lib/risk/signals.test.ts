import { describe, expect, test } from "vitest";
import { assessRisk } from "./signals";
describe("risk signals", () => {
  test("flags review without automatically punishing sellers", () => {
    expect(assessRisk({ disputeRate: 0.03, refundRate: 0.1, paymentFailures: 8 })).toEqual({ score: 5, action: "review" });
  });
});
