/**
 * A single entitlement value as stored in plans.entitlements.
 *
 * Previously declared in ./entitlements alongside a snapshot API built for the
 * seller_entitlements table. That table was never written to and is dropped in
 * 202607310052; entitlements are resolved live from the versioned plan row, so
 * this type belongs with the resolver that actually uses it.
 */
export type EntitlementValue = boolean | number | string | string[];
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

/**
 * Safety net if the Free plan row is ever missing — mirrors the seeded
 * plans.entitlements for code "free". The database row is the source of truth.
 */
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
  creatorProgram: false,
  creatorPartnerships: 0,
};

/** States that grant the paid plan's entitlements. "trialing" is only a
 * pending-checkout placeholder (we sell no trials), so it stays on Free. */
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

type SubscriptionRow = {
  state: SubscriptionState;
  grace_ends_at: string | null;
  current_period_end: string | null;
  plans: { code: string; name: string; entitlements: Record<string, EntitlementValue> } | null;
};

/** Pure resolution used by getSellerPlan and unit tests. */
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

/**
 * Resolves the seller's effective plan: the subscribed plan while the
 * subscription is active (or inside its grace window), otherwise the Free
 * plan's entitlements. Reads with the service role so gating works from any
 * request context (server actions, API routes, RSC).
 */
export async function getSellerPlan(sellerAccountId: string): Promise<SellerPlan> {
  // Lazy import: the admin client pulls in `server-only`, which client-adjacent
  // test files can't load at module scope.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const [{ data: subscription, error: subscriptionError }, { data: freePlan }] = await Promise.all([
    admin
      .from("seller_subscriptions")
      // Aliased to plan_id: seller_subscriptions has two FKs to plans (plan_id,
      // pending_plan_id), so an unaliased embed throws PGRST201.
      .select("state,grace_ends_at,current_period_end,plans!plan_id(code,name,entitlements)")
      .eq("seller_account_id", sellerAccountId)
      .maybeSingle(),
    admin
      .from("plans")
      .select("entitlements")
      .eq("code", "free")
      .eq("active", true)
      .maybeSingle(),
  ]);
  // A real query error (e.g. an ambiguous embed reintroduced by a migration,
  // a transient DB error, an RLS change) is distinct from "no subscription
  // found" — log it so it doesn't silently resolve as Free with zero signal.
  if (subscriptionError) {
    console.error("[getSellerPlan] seller_subscriptions query failed", subscriptionError);
  }
  return resolvePlanFromSubscription(
    (subscription as SubscriptionRow | null) ?? null,
    (freePlan?.entitlements as Record<string, EntitlementValue>) ?? FREE_PLAN_FALLBACK,
  );
}
