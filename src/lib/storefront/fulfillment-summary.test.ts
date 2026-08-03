import { describe, expect, it } from "vitest";

import { fulfillmentSummary } from "./fulfillment-summary";

describe("fulfillmentSummary", () => {
  it("names both when the shop offers both", () => {
    expect(fulfillmentSummary([{ type: "delivery" }, { type: "pickup" }])).toBe("Delivery & pickup");
  });

  it("does not claim delivery for a pickup-only shop", () => {
    // The header used to tell every shop's buyers "Delivers nationwide".
    expect(fulfillmentSummary([{ type: "pickup" }])).toBe("Pickup only");
  });

  it("names delivery alone", () => {
    expect(fulfillmentSummary([{ type: "delivery" }])).toBe("Delivery");
  });

  it("ignores methods the seller has switched off", () => {
    expect(fulfillmentSummary([{ type: "delivery", active: false }, { type: "pickup" }])).toBe(
      "Pickup only",
    );
  });

  /**
   * Silence is the correct answer. A shop mid-onboarding has no fulfillment
   * rows, and inventing a default is how "Delivers nationwide" happened.
   */
  it("says nothing when there is nothing to say", () => {
    expect(fulfillmentSummary([])).toBeNull();
    expect(fulfillmentSummary(null)).toBeNull();
    expect(fulfillmentSummary(undefined)).toBeNull();
    expect(fulfillmentSummary([{ type: "delivery", active: false }])).toBeNull();
  });

  it("ignores a type it does not recognise rather than guessing", () => {
    expect(fulfillmentSummary([{ type: "teleport" }, { type: null }])).toBeNull();
  });
});
