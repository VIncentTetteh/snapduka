// Ported (pure portion) from Snapduka/src/lib/billing/resolve.ts. The web's
// getSellerPlan() uses the service-role client; the mobile app runs the SAME two
// RLS-readable queries on-device and feeds the rows into resolvePlanFromSubscription.
import type { EntitlementValue } from "./entitlements";
import { effectiveSubscriptionState, type SubscriptionState } from "./subscriptions";

export type SellerPlan = {
  planCode: string;
  planName: string;
  /** "free" when the seller has no paid entitlement (no sub, expired, cancelled). */
  state: SubscriptionState | "free";
  entitlements: Record<string, EntitlementValue>;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
};

/** Safety net if the Free plan row is ever missing — mirrors seeded plans. */
export const FREE_PLAN_FALLBACK: Record<string, EntitlementValue> = {
  shops: 1,
  products: 50,
  staffAccounts: 1,
  customDomain: false,
  branding: false,
  promotions: false,
  campaigns: true,
  exports: false,
  customerSegments: 3,
  broadcastsPerMonth: 0,
  automationRules: 0,
  apiKeys: 0,
  discovery: true,
};

const ENTITLED_STATES: SubscriptionState[] = ["active", "grace"];

export function planAllows(plan: Pick<SellerPlan, "entitlements">, capability: string): boolean {
  return plan.entitlements[capability] === true;
}

/** Numeric limit for a capability; missing/non-numeric means 0 (not allowed). */
export function planLimit(plan: Pick<SellerPlan, "entitlements">, capability: string): number {
  const limit = plan.entitlements[capability];
  return typeof limit === "number" ? limit : 0;
}

export function withinPlanLimit(
  plan: Pick<SellerPlan, "entitlements">,
  capability: string,
  currentUsage: number,
): boolean {
  return currentUsage < planLimit(plan, capability);
}

export function upgradeMessage(feature: string): string {
  return `Your current plan does not include ${feature}. Upgrade in Settings → Plan & billing.`;
}

export type SubscriptionRow = {
  state: SubscriptionState;
  grace_ends_at: string | null;
  current_period_end: string | null;
  plans: { code: string; name: string; entitlements: Record<string, EntitlementValue> } | null;
};

/** Pure resolution used by both web getSellerPlan and the mobile useEntitlements hook. */
export function resolvePlanFromSubscription(
  subscription: SubscriptionRow | null,
  freeEntitlements: Record<string, EntitlementValue>,
  now = new Date(),
): SellerPlan {
  if (subscription?.plans) {
    const state = effectiveSubscriptionState(
      { state: subscription.state, graceEndsAt: subscription.grace_ends_at },
      now,
    );
    if (ENTITLED_STATES.includes(state)) {
      return {
        planCode: subscription.plans.code,
        planName: subscription.plans.name,
        state,
        entitlements: subscription.plans.entitlements,
        currentPeriodEnd: subscription.current_period_end,
        graceEndsAt: subscription.grace_ends_at,
      };
    }
  }
  return {
    planCode: "free",
    planName: "Free",
    state: "free",
    entitlements: freeEntitlements,
    currentPeriodEnd: null,
    graceEndsAt: null,
  };
}
