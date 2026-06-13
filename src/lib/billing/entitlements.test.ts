import { describe, expect, test } from "vitest";

import {
  hasCapability,
  resolveEntitlement,
  withinLimit,
  type EntitlementSnapshot,
} from "./entitlements";

const snapshot: EntitlementSnapshot = {
  planCode: "growth",
  version: 2,
  values: {
    customDomain: true,
    products: 500,
    exports: true,
  },
  effectiveAt: "2026-06-13T00:00:00.000Z",
  expiresAt: null,
  readOnlyCapabilities: [],
};

describe("entitlements", () => {
  test("resolves typed entitlement values", () => {
    expect(resolveEntitlement(snapshot, "products")).toBe(500);
    expect(resolveEntitlement(snapshot, "missing")).toBeUndefined();
  });

  test("checks boolean capabilities and downgrade read-only state", () => {
    expect(hasCapability(snapshot, "customDomain")).toBe(true);
    expect(
      hasCapability(
        { ...snapshot, readOnlyCapabilities: ["customDomain"] },
        "customDomain",
        { write: true },
      ),
    ).toBe(false);
  });

  test("enforces numeric limits without treating zero as unlimited", () => {
    expect(withinLimit(snapshot, "products", 499)).toBe(true);
    expect(withinLimit(snapshot, "products", 500)).toBe(false);
    expect(withinLimit({ ...snapshot, values: { products: 0 } }, "products", 0)).toBe(false);
  });
});
