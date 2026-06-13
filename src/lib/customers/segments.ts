export type CustomerAggregate = { orderCount: number; totalMinor: number; lastOrderAt: string | null };
export type SegmentRule = { minimumOrders?: number; minimumSpendMinor?: number; orderedWithinDays?: number };
export function matchesSegment(customer: CustomerAggregate, rule: SegmentRule, now = new Date()) {
  if (customer.orderCount < (rule.minimumOrders ?? 0) || customer.totalMinor < (rule.minimumSpendMinor ?? 0)) return false;
  if (rule.orderedWithinDays != null) {
    if (!customer.lastOrderAt) return false;
    if (now.getTime() - new Date(customer.lastOrderAt).getTime() > rule.orderedWithinDays * 86_400_000) return false;
  }
  return true;
}
