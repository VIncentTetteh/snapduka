import "server-only";

import { getSellerPlan, type SellerPlan } from "@/lib/billing/resolve";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-seller monthly AI budget, in micro-USD.
 *
 * Why constants and not a plan entitlement: plan rows are versioned and
 * immutable (`prevent_plan_version_payload_mutation`), so adding a key means a
 * new plan version for every tier — a billing change, not an AI change. Until
 * pricing decides what AI allowance each tier sells, the cap is keyed by plan
 * code here. A plan version that *does* carry `aiMonthlyBudgetUsdMicros` wins,
 * so the day billing adopts it nothing in this module has to change.
 *
 * The numbers are cost ceilings, not product allowances: at Sonnet prices $1 is
 * roughly 150 Snap-to-list drafts or 300 WhatsApp agent turns with a warm cache.
 * An unknown plan code gets the Free ceiling, never unlimited.
 */
export const AI_MONTHLY_BUDGET_USD_MICROS: Record<string, number> = {
  free: 1_000_000,
  growth: 10_000_000,
  scale: 50_000_000,
};

const ENTITLEMENT_KEY = "aiMonthlyBudgetUsdMicros";

export function monthlyBudgetMicros(plan: Pick<SellerPlan, "planCode" | "entitlements">): number {
  const override = plan.entitlements[ENTITLEMENT_KEY];
  if (typeof override === "number" && override >= 0) return override;
  return AI_MONTHLY_BUDGET_USD_MICROS[plan.planCode] ?? AI_MONTHLY_BUDGET_USD_MICROS.free;
}

export type BudgetCheck =
  | { ok: true; spentMicros: number; budgetMicros: number }
  | { ok: false; spentMicros: number; budgetMicros: number };

/**
 * Whether the seller can afford another call this month.
 *
 * Checked before the call, against spend already recorded, so one call can
 * overshoot by at most its own cost — bounded by max_tokens, and cheaper than a
 * reservation scheme. Fails closed: if spend cannot be read, the call does not
 * happen, because an unbounded bill is worse than a declined draft.
 */
export async function checkAiBudget(sellerAccountId: string): Promise<BudgetCheck> {
  const [plan, spend] = await Promise.all([
    getSellerPlan(sellerAccountId),
    createAdminClient().rpc("ai_spend_this_month", { p_seller_account_id: sellerAccountId }),
  ]);
  const budgetMicros = monthlyBudgetMicros(plan);
  if (spend.error || typeof spend.data !== "number") {
    console.error("[ai/budget] could not read spend; refusing the call", spend.error);
    return { ok: false, spentMicros: 0, budgetMicros };
  }
  const spentMicros = spend.data;
  return spentMicros < budgetMicros
    ? { ok: true, spentMicros, budgetMicros }
    : { ok: false, spentMicros, budgetMicros };
}
