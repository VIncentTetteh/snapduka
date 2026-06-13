import { describe, expect, it } from "vitest";

import { parseFulfillmentMethod } from "@/lib/fulfillment/schema";

describe("parseFulfillmentMethod", () => {
  it("accepts seller delivery and pickup with integer fees", () => {
    expect(
      parseFulfillmentMethod({
        type: "delivery",
        name: "Accra delivery",
        feeMinor: "2500",
        instructions: "Same-day within Accra",
      }).success,
    ).toBe(true);
    expect(
      parseFulfillmentMethod({
        type: "pickup",
        name: "Osu pickup",
        feeMinor: "0",
        instructions: "Call on arrival",
      }).success,
    ).toBe(true);
  });

  it("rejects fractional fees", () => {
    expect(
      parseFulfillmentMethod({
        type: "delivery",
        name: "Delivery",
        feeMinor: "2.50",
        instructions: "",
      }).success,
    ).toBe(false);
  });
});
