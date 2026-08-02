import { describe, expect, it } from "vitest";

import {
  courierLabel,
  courierOptions,
  isCourierKey,
  requiresCustomName,
  type CourierKey,
} from "./catalogue";

describe("courierOptions", () => {
  it("offers couriers that actually operate in the seller's market", () => {
    const gh = courierOptions("GH").map((option) => option.key);
    const ng = courierOptions("NG").map((option) => option.key);

    expect(gh).toContain("bolt");
    expect(gh).toContain("yango");
    // GIG, Kwik and Gokada are Nigerian; offering them in Accra is noise.
    expect(gh).not.toContain("gig");
    expect(ng).toContain("gig");
    expect(ng).toContain("kwik");
  });

  // A seller in Tamale using a courier nobody has heard of must never be
  // blocked by a list we maintain.
  it("always ends with the escape hatches, in every market", () => {
    for (const country of ["GH", "NG", "CI"] as const) {
      const keys = courierOptions(country).map((option) => option.key);
      expect(keys.slice(-2)).toEqual(["self", "other"]);
    }
  });

  it("never offers the legacy 'manual' key", () => {
    for (const country of ["GH", "NG", "CI"] as const) {
      expect(courierOptions(country).map((option) => option.key)).not.toContain("manual");
    }
  });

  it("gives every option a label", () => {
    for (const option of courierOptions("GH")) {
      expect(option.label.trim()).not.toBe("");
    }
  });
});

describe("courierLabel", () => {
  it("uses the catalogue name for a known courier", () => {
    expect(courierLabel("bolt")).toBe("Bolt");
    expect(courierLabel("gig")).toBe("GIG Logistics");
  });

  /**
   * The buyer's receipt must not be able to say a Bolt delivery was something
   * else. A custom name is honoured only where the seller is describing their
   * own arrangement.
   */
  it("ignores a custom name on a known courier", () => {
    expect(courierLabel("bolt", "Definitely Not Bolt")).toBe("Bolt");
  });

  it("uses the seller's own words for 'other' and 'self'", () => {
    expect(courierLabel("other", "Kwame Express")).toBe("Kwame Express");
    expect(courierLabel("self", "Ama on the red motorbike")).toBe("Ama on the red motorbike");
  });

  it("falls back to a sensible label when 'other' has no name", () => {
    expect(courierLabel("other", "  ")).toBe("Other");
    expect(courierLabel("self")).toBe("Own rider");
  });

  // Shipments booked before the picker existed all have provider='manual'.
  it("keeps legacy shipments readable", () => {
    expect(courierLabel("manual")).toBe("Seller-arranged delivery");
  });

  it("never returns an empty string, whatever it is handed", () => {
    expect(courierLabel("bogus" as CourierKey)).toBe("Seller-arranged delivery");
  });
});

describe("isCourierKey", () => {
  it("accepts catalogue keys", () => {
    expect(isCourierKey("bolt")).toBe(true);
    expect(isCourierKey("manual")).toBe(true);
  });

  it("rejects anything else, so the API cannot store free text", () => {
    expect(isCourierKey("dhl-express")).toBe(false);
    expect(isCourierKey("")).toBe(false);
    expect(isCourierKey("constructor")).toBe(false);
  });
});

describe("requiresCustomName", () => {
  it("requires a name only for 'other'", () => {
    expect(requiresCustomName("other")).toBe(true);
    // "Own rider" already reads clearly to a buyer.
    expect(requiresCustomName("self")).toBe(false);
    expect(requiresCustomName("bolt")).toBe(false);
  });
});
