import { describe, expect, it } from "vitest";

import { ghanaPostGpsError, normalizeGhanaPostGps, parseGhanaPostGps } from "./ghanapost";
import { deliveryAddressExtrasSchema, roundCoordinate } from "./types";

describe("parseGhanaPostGps", () => {
  it.each([
    ["GA-123-4567", "GA-123-4567"],
    ["ga-123-4567", "GA-123-4567"],
    ["  ak 485 9321 ", "AK-485-9321"],
    ["GA1234567", "GA-123-4567"],
    ["GA12345678", "GA-1234-5678"],
    ["GA - 123 - 4567", "GA-123-4567"],
    ["gw-0617-6543", "GW-0617-6543"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normalizeGhanaPostGps(input)).toBe(expected);
  });

  it("splits the code into its parts", () => {
    const result = parseGhanaPostGps("AK-485-9321");
    expect(result).toEqual({
      ok: true,
      address: {
        code: "AK-485-9321",
        regionLetter: "A",
        districtLetter: "K",
        areaCode: "485",
        uniqueCode: "9321",
        regionName: "Ashanti",
      },
    });
  });

  it.each([
    ["", "empty"],
    [null, "empty"],
    ["G-123-4567", "format"],
    ["GA-12-4567", "format"],
    ["GA-123-456", "format"],
    ["GA-12345-6789", "format"],
    ["12-123-4567", "format"],
    ["GA_123_4567", "format"],
    // O is not a region letter; it is almost always a mistyped G.
    ["OA-123-4567", "region"],
  ])("rejects %j as %s", (input, reason) => {
    expect(parseGhanaPostGps(input)).toEqual({ ok: false, reason });
  });

  it("only complains about something the buyer actually typed", () => {
    expect(ghanaPostGpsError("")).toBeNull();
    expect(ghanaPostGpsError("GA-123-4567")).toBeNull();
    expect(ghanaPostGpsError("GA-12")).toMatch(/GA-123-4567/);
  });
});

describe("deliveryAddressExtrasSchema", () => {
  it("accepts an empty object", () => {
    expect(deliveryAddressExtrasSchema.safeParse({}).success).toBe(true);
  });

  it("requires both halves of a pin", () => {
    expect(deliveryAddressExtrasSchema.safeParse({ lat: 5.6 }).success).toBe(false);
    expect(deliveryAddressExtrasSchema.safeParse({ lat: 5.6, lng: -0.18 }).success).toBe(true);
  });

  it("refuses coordinates off the planet", () => {
    expect(deliveryAddressExtrasSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
  });

  it("rounds to six decimal places", () => {
    expect(roundCoordinate(5.603716789)).toBe(5.603717);
  });
});
