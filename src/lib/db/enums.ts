/**
 * Narrowing arbitrary strings onto database enums.
 *
 * Form fields, query parameters and API bodies all arrive as `string`, and most
 * of them end up in an enum column. Passing them straight through means a
 * malformed value travels all the way to Postgres to be rejected there — as a
 * 500, with a constraint name, at the point of the write rather than the point
 * of the mistake.
 */

/** The value if it is one of `allowed`, otherwise undefined. */
export function oneOf<const T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
): T[number] | undefined {
  return value != null && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

/** The value if it is one of `allowed`, otherwise `fallback`. */
export function oneOfOr<const T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  return oneOf(value, allowed) ?? fallback;
}

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export const ORDER_STATUSES = [
  "draft",
  "pending",
  "confirmed",
  "processing",
  "completed",
  "cancelled",
] as const;
export const COUNTRIES = ["GH", "NG", "CI"] as const;
export const CURRENCIES = ["GHS", "NGN", "XOF"] as const;
export const SELLER_STATUSES = ["pending", "active", "suspended", "closed"] as const;
export const TEAM_ROLES = ["manager", "catalog", "fulfillment", "support", "analyst"] as const;
export const VERIFICATION_STATES = [
  "not_started",
  "in_progress",
  "needs_action",
  "verified",
  "rejected",
  "suspended",
] as const;
export const PROMOTION_KINDS = ["fixed", "percentage"] as const;
export const CASE_STATES = [
  "opened",
  "seller_response_due",
  "under_review",
  "resolved",
  "closed",
] as const;
