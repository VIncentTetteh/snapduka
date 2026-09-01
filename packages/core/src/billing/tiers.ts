/**
 * Ordering of the plans, and what moving between two of them means.
 *
 * Whether a change is an upgrade decides real behaviour: an upgrade is charged
 * immediately, a downgrade is scheduled for the end of the paid period so the
 * seller keeps what they bought. The web billing action has carried this table
 * privately; it lives here so the app can label the same move the same way
 * rather than guessing from prices, which would get yearly-vs-monthly wrong.
 */
export const PLAN_TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

/** Yearly is the larger commitment, so moving onto it is treated as an upgrade. */
export const INTERVAL_RANK: Record<string, number> = { monthly: 0, yearly: 1, annually: 1 };

export type PlanChangeKind = "current" | "upgrade" | "downgrade";

/**
 * How `targetCode` compares with the plan the seller is on.
 *
 * `current` means the same plan at the same interval — the one case where
 * offering a change button is just a way to produce an error.
 */
export function planChangeKind(input: {
  currentCode: string;
  targetCode: string;
  currentInterval?: string;
  targetInterval?: string;
}): PlanChangeKind {
  const current = PLAN_TIER[input.currentCode] ?? 0;
  const target = PLAN_TIER[input.targetCode] ?? 0;

  if (target > current) return "upgrade";
  if (target < current) return "downgrade";

  // Same tier: the interval decides, so a seller can still move monthly→yearly.
  const from = INTERVAL_RANK[input.currentInterval ?? "monthly"] ?? 0;
  const to = INTERVAL_RANK[input.targetInterval ?? "monthly"] ?? 0;
  if (to > from) return "upgrade";
  if (to < from) return "downgrade";
  return "current";
}
