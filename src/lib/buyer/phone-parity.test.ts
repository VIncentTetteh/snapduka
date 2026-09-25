import { describe, expect, it } from "vitest";

import { normalizePhoneNumber } from "@/lib/auth/onboarding";

/**
 * claim_guest_orders() matches orders by `buyer_normalize_phone()` in SQL
 * (202609250170), which mirrors normalizePhoneNumber() — the function checkout
 * runs before buyer_snapshot is stored. If the two ever disagree, claims
 * silently miss orders. These are the same vectors pinned on the SQL side in
 * supabase/tests/database/071_buyer_claim_lifecycle.test.sql; change both
 * together or neither.
 */
const VECTORS: [string, "GH" | "NG" | "CI", string][] = [
  ["0241234567", "GH", "+233241234567"],
  ["233241234567", "GH", "+233241234567"],
  ["024 117 1001", "GH", "+233241171001"],
  ["+234 801 234 5678", "NG", "+2348012345678"],
  ["0708091011", "CI", "+2250708091011"],
];

describe("phone normalisation parity with SQL buyer_normalize_phone", () => {
  it.each(VECTORS)("%s (%s) -> %s", (input, country, expected) => {
    expect(normalizePhoneNumber(input, country)).toBe(expected);
  });
});
