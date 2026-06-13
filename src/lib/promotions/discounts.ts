export type DiscountRule = { kind: "fixed" | "percentage"; value: number; minimumMinor?: number; maximumMinor?: number };
export function calculateDiscount(rule: DiscountRule, subtotalMinor: number) {
  if (subtotalMinor < (rule.minimumMinor ?? 0)) return 0;
  const raw = rule.kind === "fixed" ? rule.value : Math.floor(subtotalMinor * rule.value / 100);
  return Math.max(0, Math.min(subtotalMinor, rule.maximumMinor == null ? raw : Math.min(raw, rule.maximumMinor)));
}
