import { describe, expect, it } from "vitest";
import { effectiveSubscriptionState } from "./subscriptions";
import {
  FREE_PLAN_FALLBACK,
  planAllows,
  planLimit,
  resolvePlanFromSubscription,
  withinPlanLimit,
  type SubscriptionRow,
} from "./resolve";

describe("billing resolve/subscriptions", () => {
  it("falls back to Free when there is no subscription", () => {
    const plan = resolvePlanFromSubscription(null, FREE_PLAN_FALLBACK);
    expect(plan.state).toBe("free");
    expect(planLimit(plan, "products")).toBe(50);
    expect(planAllows(plan, "branding")).toBe(false);
  });

  it("grants the paid plan entitlements while active", () => {
    const sub: SubscriptionRow = {
      state: "active",
      grace_ends_at: null,
      current_period_end: "2026-12-31T00:00:00Z",
      plans: { code: "scale", name: "Scale", entitlements: { products: 5000, branding: true } },
    };
    const plan = resolvePlanFromSubscription(sub, FREE_PLAN_FALLBACK);
    expect(plan.planCode).toBe("scale");
    expect(planAllows(plan, "branding")).toBe(true);
    expect(withinPlanLimit(plan, "products", 60)).toBe(true);
  });

  it("drops an expired past_due subscription back to Free", () => {
    const sub: SubscriptionRow = {
      state: "past_due",
      grace_ends_at: "2020-01-01T00:00:00Z", // grace already elapsed
      current_period_end: null,
      plans: { code: "growth", name: "Growth", entitlements: { products: 500 } },
    };
    const plan = resolvePlanFromSubscription(sub, FREE_PLAN_FALLBACK);
    expect(plan.state).toBe("free");
    expect(planLimit(plan, "products")).toBe(50);
  });

  it("treats past_due within grace as entitled", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      effectiveSubscriptionState({ state: "past_due", graceEndsAt: future }),
    ).toBe("grace");
  });
});
