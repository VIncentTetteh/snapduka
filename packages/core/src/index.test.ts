import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  formatMoney,
  getCountryConfig,
  hasCapability,
  hasPermission,
  isValidPhoneForCountry,
  normalizePhone,
  validatePhone,
  withinLimit,
  type EntitlementSnapshot,
} from "./index";

const freePlan: EntitlementSnapshot = {
  planCode: "free",
  version: 1,
  values: { products: 50, discovery: false, branding: true },
  effectiveAt: "2026-01-01T00:00:00Z",
  expiresAt: null,
  readOnlyCapabilities: ["branding"],
};

describe("@snapduka/core", () => {
  it("resolves country config and currency", () => {
    expect(getCountryConfig("GH").currency).toBe("GHS");
    expect(getCountryConfig("CI").currency).toBe("XOF");
    expect(() => getCountryConfig("US")).toThrow();
  });

  it("formats money with currency-correct minor units", () => {
    expect(formatMoney(12345, "GHS")).toContain("123.45");
    expect(formatMoney(5000, "XOF")).toContain("5,000");
  });

  it("normalizes and validates phone numbers per country", () => {
    expect(normalizePhone("0241234567", "GH")).toBe("+233241234567");
    expect(isValidPhoneForCountry("+233241234567", "GH")).toBe(true);
    expect(validatePhone("024123", "GH")).not.toBeNull();
  });

  it("gates capabilities and limits from entitlement snapshots", () => {
    expect(hasCapability(freePlan, "discovery")).toBe(false);
    expect(hasCapability(freePlan, "branding")).toBe(true);
    // read-only capability rejects writes even when present
    expect(hasCapability(freePlan, "branding", { write: true })).toBe(false);
    expect(withinLimit(freePlan, "products", 49)).toBe(true);
    expect(withinLimit(freePlan, "products", 50)).toBe(false);
  });

  it("enforces the RBAC matrix", () => {
    expect(hasPermission("owner", "billing.manage")).toBe(true);
    expect(hasPermission("fulfillment", "billing.manage")).toBe(false);
    expect(hasPermission("fulfillment", "orders.manage")).toBe(true);
  });

  it("guards order state transitions", () => {
    expect(canTransitionOrder("pending", "confirmed")).toBe(true);
    expect(canTransitionOrder("completed", "cancelled")).toBe(false);
  });
});
