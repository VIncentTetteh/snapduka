import { describe, expect, it } from "vitest";

import {
  FREE_PLAN_FALLBACK,
  planAllows,
  planLimit,
  resolvePlanFromSubscription,
  withinPlanLimit,
} from "./resolve";

const growth = {
  code: "growth",
  name: "Growth",
  entitlements: {
    products: 500,
    staffAccounts: 3,
    promotions: true,
    customDomain: true,
    broadcastsPerMonth: 10,
  },
};

describe("resolvePlanFromSubscription", () => {
  it("falls back to free when there is no subscription", () => {
    const plan = resolvePlanFromSubscription(null, FREE_PLAN_FALLBACK);
    expect(plan.planCode).toBe("free");
    expect(plan.state).toBe("free");
    expect(planAllows(plan, "promotions")).toBe(false);
    expect(planAllows(plan, "campaigns")).toBe(true);
  });

  it("grants plan entitlements while active", () => {
    const plan = resolvePlanFromSubscription(
      { state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z", plans: growth },
      FREE_PLAN_FALLBACK,
    );
    expect(plan.planCode).toBe("growth");
    expect(planAllows(plan, "promotions")).toBe(true);
    expect(planLimit(plan, "products")).toBe(500);
  });

  it("keeps entitlements inside the grace window and drops them after", () => {
    const graceEnd = new Date(Date.now() + 86_400_000).toISOString();
    const inGrace = resolvePlanFromSubscription(
      { state: "past_due", grace_ends_at: graceEnd, current_period_end: null, plans: growth },
      FREE_PLAN_FALLBACK,
    );
    expect(inGrace.planCode).toBe("growth");
    expect(inGrace.state).toBe("grace");

    const afterGrace = resolvePlanFromSubscription(
      { state: "past_due", grace_ends_at: graceEnd, current_period_end: null, plans: growth },
      FREE_PLAN_FALLBACK,
      new Date(Date.now() + 3 * 86_400_000),
    );
    expect(afterGrace.planCode).toBe("free");
  });

  it("treats trialing, cancelled and expired as free", () => {
    for (const state of ["trialing", "cancelled", "expired"] as const) {
      const plan = resolvePlanFromSubscription(
        { state, grace_ends_at: null, current_period_end: null, plans: growth },
        FREE_PLAN_FALLBACK,
      );
      expect(plan.planCode).toBe("free");
    }
  });
});

describe("limits", () => {
  const plan = { entitlements: FREE_PLAN_FALLBACK };
  it("enforces numeric limits", () => {
    expect(withinPlanLimit(plan, "products", 49)).toBe(true);
    expect(withinPlanLimit(plan, "products", 50)).toBe(false);
    expect(withinPlanLimit(plan, "apiKeys", 0)).toBe(false);
  });
  it("missing capabilities resolve to zero / false", () => {
    expect(planLimit(plan, "unknownThing")).toBe(0);
    expect(planAllows(plan, "unknownThing")).toBe(false);
  });
});
