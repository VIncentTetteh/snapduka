/**
 * Customer segment rules.
 *
 * Pure and shared so a segment previewed on the phone contains the same people
 * the marketing worker later sends to. The mobile screen used to write
 * `rules: {}` for every segment, which matches nobody — sellers could create
 * segments all day and none of them would ever have a member.
 */
export type CustomerAggregate = {
  orderCount: number;
  totalMinor: number;
  lastOrderAt: string | null;
};

export type SegmentRule = {
  minimumOrders?: number;
  minimumSpendMinor?: number;
  orderedWithinDays?: number;
};

export function matchesSegment(
  customer: CustomerAggregate,
  rule: SegmentRule,
  now = new Date(),
): boolean {
  if (
    customer.orderCount < (rule.minimumOrders ?? 0) ||
    customer.totalMinor < (rule.minimumSpendMinor ?? 0)
  ) {
    return false;
  }
  if (rule.orderedWithinDays != null) {
    if (!customer.lastOrderAt) return false;
    if (
      now.getTime() - new Date(customer.lastOrderAt).getTime() >
      rule.orderedWithinDays * 86_400_000
    ) {
      return false;
    }
  }
  return true;
}

/** True when a rule would match every customer — i.e. it is not a segment. */
export function isEmptyRule(rule: SegmentRule): boolean {
  return (
    !rule.minimumOrders &&
    !rule.minimumSpendMinor &&
    rule.orderedWithinDays == null
  );
}
