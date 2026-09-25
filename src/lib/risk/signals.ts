/**
 * Risk rules: pure functions from facts to findings. No I/O here — gathering
 * the facts and recording what fires lives in ./engine.ts — so every rule is
 * unit-testable and the whole set can be replayed against history.
 *
 * Rules are versioned. RISK_RULES_VERSION is stored on every risk_signals row,
 * so a signal can always be explained by the rules that produced it; bump it
 * whenever a threshold or a rule changes.
 *
 * Nothing here blocks anything today. Every rule is observe-only: findings are
 * written to risk_signals for operators, and the sale / payout / verification
 * proceeds exactly as before. `shouldBlockLater` marks the rules we expect to
 * promote to blocking once a few weeks of signals have shown their false-
 * positive rate:
 *
 *   BLOCKING CANDIDATES (promote after review of their signal history)
 *   - buyer_order_velocity          -> hold payment initialisation (card testing)
 *   - new_account_high_value_payout -> hold the payout for operator review
 *   - kyc_mismatch                  -> require manual verification review
 *   STAY OBSERVE-ONLY (too noisy to block on alone; feed the trust score)
 *   - seller_order_spike_new_account, new_account_high_value_order,
 *     payout_velocity, seller_rates, kyc_repeated_failures
 */

export const RISK_RULES_VERSION = "2026-09-25.1";

export type RiskContext = "checkout_init" | "payout_request" | "kyc_result";

export type RiskRuleId =
  | "buyer_order_velocity"
  | "seller_order_spike_new_account"
  | "new_account_high_value_order"
  | "payout_velocity"
  | "new_account_high_value_payout"
  | "seller_rates"
  | "kyc_mismatch"
  | "kyc_repeated_failures";

export type RiskFacts = {
  accountAgeDays: number;
  currency?: "GHS" | "NGN" | "XOF";
  // checkout_init
  orderTotalMinor?: number;
  buyerOrdersLastHour?: number;
  sellerOrdersLastHour?: number;
  // payout_request
  payoutAmountMinor?: number;
  payoutsLast24h?: number;
  disputeRate?: number;
  refundRate?: number;
  paymentFailures?: number;
  // kyc_result
  kycStatus?: string;
  kycMatchScore?: number | null;
  kycFailuresLast30d?: number;
};

export type RiskFinding = {
  rule: RiskRuleId;
  /** 0-100, how strongly this finding alone suggests risk. */
  score: number;
  reason: string;
  details: Record<string, string | number | boolean | null>;
  shouldBlockLater: boolean;
};

/** "New" for risk purposes. */
export const NEW_ACCOUNT_DAYS = 14;
export const NEW_ACCOUNT_PAYOUT_DAYS = 30;

/**
 * Roughly USD 150 in each currency: well above a typical first order on a
 * social-commerce shop, well below what a real merchant moves.
 */
export const HIGH_VALUE_MINOR: Record<"GHS" | "NGN" | "XOF", number> = {
  GHS: 200_000,
  NGN: 20_000_000,
  XOF: 100_000,
};

export const THRESHOLDS = {
  buyerOrdersPerHour: 5,
  sellerOrdersPerHourNewAccount: 20,
  payoutsPer24h: 3,
  kycMismatchScore: 50,
  kycFailuresPer30d: 3,
} as const;

/**
 * The original rate rule, kept as-is: it predates the engine and its
 * thresholds are what the seller_rates rule applies at payout time.
 */
export function assessRisk(input: { disputeRate: number; refundRate: number; paymentFailures: number }) {
  const score =
    (input.disputeRate >= 0.02 ? 2 : 0) + (input.refundRate >= 0.08 ? 2 : 0) + (input.paymentFailures >= 5 ? 1 : 0);
  return { score, action: score >= 3 ? ("review" as const) : ("monitor" as const) };
}

function highValue(amountMinor: number | undefined, currency: RiskFacts["currency"]): boolean {
  if (amountMinor === undefined || !currency) return false;
  return amountMinor >= HIGH_VALUE_MINOR[currency];
}

function checkoutRules(facts: RiskFacts): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const isNew = facts.accountAgeDays < NEW_ACCOUNT_DAYS;
  if ((facts.buyerOrdersLastHour ?? 0) >= THRESHOLDS.buyerOrdersPerHour) {
    findings.push({
      rule: "buyer_order_velocity",
      score: 40,
      reason: "The same buyer started many payments in an hour.",
      details: { buyerOrdersLastHour: facts.buyerOrdersLastHour ?? 0 },
      shouldBlockLater: true,
    });
  }
  if (isNew && (facts.sellerOrdersLastHour ?? 0) >= THRESHOLDS.sellerOrdersPerHourNewAccount) {
    findings.push({
      rule: "seller_order_spike_new_account",
      score: 50,
      reason: "A new shop received an unusual burst of orders.",
      details: { sellerOrdersLastHour: facts.sellerOrdersLastHour ?? 0, accountAgeDays: Math.floor(facts.accountAgeDays) },
      shouldBlockLater: false,
    });
  }
  if (isNew && highValue(facts.orderTotalMinor, facts.currency)) {
    findings.push({
      rule: "new_account_high_value_order",
      score: 45,
      reason: "A new shop is taking a high-value payment.",
      details: { orderTotalMinor: facts.orderTotalMinor ?? 0, currency: facts.currency ?? null, accountAgeDays: Math.floor(facts.accountAgeDays) },
      shouldBlockLater: false,
    });
  }
  return findings;
}

function payoutRules(facts: RiskFacts): RiskFinding[] {
  const findings: RiskFinding[] = [];
  if ((facts.payoutsLast24h ?? 0) >= THRESHOLDS.payoutsPer24h) {
    findings.push({
      rule: "payout_velocity",
      score: 40,
      reason: "Several withdrawals requested within a day.",
      details: { payoutsLast24h: facts.payoutsLast24h ?? 0 },
      shouldBlockLater: false,
    });
  }
  if (facts.accountAgeDays < NEW_ACCOUNT_PAYOUT_DAYS && highValue(facts.payoutAmountMinor, facts.currency)) {
    findings.push({
      rule: "new_account_high_value_payout",
      score: 55,
      reason: "A new account is withdrawing a large amount.",
      details: { payoutAmountMinor: facts.payoutAmountMinor ?? 0, currency: facts.currency ?? null, accountAgeDays: Math.floor(facts.accountAgeDays) },
      shouldBlockLater: true,
    });
  }
  const rates = assessRisk({
    disputeRate: facts.disputeRate ?? 0,
    refundRate: facts.refundRate ?? 0,
    paymentFailures: facts.paymentFailures ?? 0,
  });
  if (rates.action === "review") {
    findings.push({
      rule: "seller_rates",
      score: 60,
      reason: "Dispute, refund or payment-failure rates are high.",
      details: {
        disputeRate: facts.disputeRate ?? 0,
        refundRate: facts.refundRate ?? 0,
        paymentFailures: facts.paymentFailures ?? 0,
        rateScore: rates.score,
      },
      shouldBlockLater: false,
    });
  }
  return findings;
}

function kycRules(facts: RiskFacts): RiskFinding[] {
  const findings: RiskFinding[] = [];
  if (
    facts.kycStatus === "failed" &&
    typeof facts.kycMatchScore === "number" &&
    facts.kycMatchScore < THRESHOLDS.kycMismatchScore
  ) {
    findings.push({
      rule: "kyc_mismatch",
      score: 70,
      reason: "The identity check did not match the person.",
      details: { matchScore: facts.kycMatchScore },
      shouldBlockLater: true,
    });
  }
  if ((facts.kycFailuresLast30d ?? 0) >= THRESHOLDS.kycFailuresPer30d) {
    findings.push({
      rule: "kyc_repeated_failures",
      score: 60,
      reason: "Several failed identity checks in a month.",
      details: { failuresLast30d: facts.kycFailuresLast30d ?? 0 },
      shouldBlockLater: false,
    });
  }
  return findings;
}

export function evaluateRiskRules(context: RiskContext, facts: RiskFacts): RiskFinding[] {
  switch (context) {
    case "checkout_init":
      return checkoutRules(facts);
    case "payout_request":
      return payoutRules(facts);
    case "kyc_result":
      return kycRules(facts);
  }
}
