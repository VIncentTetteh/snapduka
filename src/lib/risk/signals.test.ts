import { describe, expect, test } from "vitest";

import { assessRisk, evaluateRiskRules, HIGH_VALUE_MINOR, RISK_RULES_VERSION } from "./signals";

describe("risk signals", () => {
  test("flags review without automatically punishing sellers", () => {
    expect(assessRisk({ disputeRate: 0.03, refundRate: 0.1, paymentFailures: 8 })).toEqual({ score: 5, action: "review" });
  });

  test("the rule set is versioned", () => {
    expect(RISK_RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("checkout_init rules", () => {
  const established = { accountAgeDays: 400, currency: "GHS" as const };

  test("a quiet checkout fires nothing", () => {
    expect(evaluateRiskRules("checkout_init", { ...established, orderTotalMinor: 5000, buyerOrdersLastHour: 1, sellerOrdersLastHour: 3 })).toEqual([]);
  });

  test("buyer velocity is a blocking candidate", () => {
    const [finding] = evaluateRiskRules("checkout_init", { ...established, buyerOrdersLastHour: 5 });
    expect(finding).toMatchObject({ rule: "buyer_order_velocity", shouldBlockLater: true });
  });

  test("a new shop taking a high-value payment is flagged; an established one is not", () => {
    const total = HIGH_VALUE_MINOR.GHS;
    expect(evaluateRiskRules("checkout_init", { accountAgeDays: 2, currency: "GHS", orderTotalMinor: total }).map((f) => f.rule))
      .toEqual(["new_account_high_value_order"]);
    expect(evaluateRiskRules("checkout_init", { ...established, orderTotalMinor: total })).toEqual([]);
  });

  test("an order burst matters only for a new shop", () => {
    expect(evaluateRiskRules("checkout_init", { accountAgeDays: 3, sellerOrdersLastHour: 25 }).map((f) => f.rule))
      .toEqual(["seller_order_spike_new_account"]);
    expect(evaluateRiskRules("checkout_init", { accountAgeDays: 300, sellerOrdersLastHour: 25 })).toEqual([]);
  });
});

describe("payout_request rules", () => {
  test("velocity, new-account value and bad rates each fire", () => {
    const rules = evaluateRiskRules("payout_request", {
      accountAgeDays: 10,
      currency: "NGN",
      payoutAmountMinor: HIGH_VALUE_MINOR.NGN,
      payoutsLast24h: 3,
      disputeRate: 0.05,
      refundRate: 0.2,
      paymentFailures: 0,
    }).map((f) => f.rule);
    expect(rules).toEqual(["payout_velocity", "new_account_high_value_payout", "seller_rates"]);
  });

  test("an ordinary payout fires nothing", () => {
    expect(evaluateRiskRules("payout_request", { accountAgeDays: 200, currency: "GHS", payoutAmountMinor: 50_000, payoutsLast24h: 1 })).toEqual([]);
  });
});

describe("kyc_result rules", () => {
  test("a low-score failure is a mismatch", () => {
    expect(evaluateRiskRules("kyc_result", { accountAgeDays: 1, kycStatus: "failed", kycMatchScore: 12 })[0])
      .toMatchObject({ rule: "kyc_mismatch", shouldBlockLater: true });
  });

  test("a failure without a score is not called a mismatch", () => {
    expect(evaluateRiskRules("kyc_result", { accountAgeDays: 1, kycStatus: "failed", kycMatchScore: null })).toEqual([]);
  });

  test("repeated failures fire", () => {
    expect(evaluateRiskRules("kyc_result", { accountAgeDays: 1, kycStatus: "failed", kycFailuresLast30d: 3 }).map((f) => f.rule))
      .toEqual(["kyc_repeated_failures"]);
  });

  test("a pass fires nothing", () => {
    expect(evaluateRiskRules("kyc_result", { accountAgeDays: 1, kycStatus: "passed", kycMatchScore: 99 })).toEqual([]);
  });
});
