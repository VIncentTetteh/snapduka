import { describe, expect, it } from "vitest";

import { buyerAddressInputSchema, toAddressColumns, toDeliveryAddress, type BuyerAddressRow } from "./addresses";

describe("buyerAddressInputSchema", () => {
  it("accepts the classic four fields and fills the rest", () => {
    const parsed = buyerAddressInputSchema.parse({ line1: " 12 Oxford St ", city: "Accra" });

    expect(toAddressColumns(parsed)).toEqual({
      label: null,
      line1: "12 Oxford St",
      area: "",
      city: "Accra",
      region: "",
      country: "GH",
      digital_address: null,
      landmark: null,
      lat: null,
      lng: null,
      geo_source: "none",
    });
  });

  it("stores a GhanaPostGPS code in its canonical form", () => {
    const parsed = buyerAddressInputSchema.parse({ line1: "x", city: "Accra", digitalAddress: "ga 123 4567" });

    expect(toAddressColumns(parsed)).toMatchObject({ digital_address: "GA-123-4567", geo_source: "digital_address" });
  });

  it("rejects a malformed digital address with the buyer-facing message", () => {
    const result = buyerAddressInputSchema.safeParse({ line1: "x", city: "Accra", digitalAddress: "not-a-code" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["digitalAddress"]);
  });

  it("refuses half a location pin", () => {
    expect(buyerAddressInputSchema.safeParse({ line1: "x", city: "Accra", lat: 5.6 }).success).toBe(false);
  });

  it("rounds a pin to six decimals and marks it as a device fix", () => {
    const parsed = buyerAddressInputSchema.parse({ line1: "x", city: "Accra", lat: 5.603716789, lng: -0.186964321 });

    expect(toAddressColumns(parsed)).toMatchObject({ lat: 5.603717, lng: -0.186964, geo_source: "device" });
  });

  it("requires a street and a city", () => {
    const result = buyerAddressInputSchema.safeParse({ line1: " ", city: "" });

    expect(result.success).toBe(false);
  });
});

describe("toDeliveryAddress", () => {
  it("maps a saved row to the shared DeliveryAddress shape", () => {
    const row: BuyerAddressRow = {
      id: "a1",
      buyer_profile_id: "p1",
      label: "Home",
      line1: "12 Oxford St",
      area: "Osu",
      city: "Accra",
      region: "Greater Accra",
      country: "GH",
      digital_address: "GA-123-4567",
      lat: null,
      lng: null,
      landmark: "Opposite the Total station",
      geo_source: "digital_address",
      created_at: "2026-09-25T00:00:00Z",
      updated_at: "2026-09-25T00:00:00Z",
    };

    expect(toDeliveryAddress(row)).toEqual({
      line1: "12 Oxford St",
      area: "Osu",
      city: "Accra",
      region: "Greater Accra",
      country: "GH",
      digitalAddress: "GA-123-4567",
      lat: null,
      lng: null,
      landmark: "Opposite the Total station",
      geoSource: "digital_address",
    });
  });
});
