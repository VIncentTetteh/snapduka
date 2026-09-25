import { describe, expect, it } from "vitest";

import {
  deliveryAddressFromJson,
  deliveryMapUrl,
  formatDeliveryAddressLine,
  orderDeliveryAddress,
} from "./snapshot";

describe("deliveryAddressFromJson", () => {
  it("reads and cleans a stored address", () => {
    expect(
      deliveryAddressFromJson(
        { line1: " 4 Palm St ", city: "Accra", digitalAddress: "ga1234567", landmark: "Blue gate", lat: 5.60371234, lng: -0.187 },
        "GH",
      ),
    ).toEqual({
      line1: "4 Palm St",
      area: "",
      city: "Accra",
      region: "",
      country: "GH",
      digitalAddress: "GA-123-4567",
      landmark: "Blue gate",
      lat: 5.603712,
      lng: -0.187,
      geoSource: "device",
    });
  });

  it("drops half a pin, a pin as strings, and codes outside Ghana", () => {
    expect(deliveryAddressFromJson({ city: "Accra", lat: 5.6 }, "GH")).toMatchObject({ lat: null, lng: null, geoSource: "none" });
    expect(deliveryAddressFromJson({ city: "Accra", lat: "5.6", lng: "0" }, "GH")).toMatchObject({ lat: null });
    expect(deliveryAddressFromJson({ city: "Lagos", digitalAddress: "GA-123-4567" }, "NG")?.digitalAddress).toBeNull();
  });

  it("returns null for nothing usable", () => {
    expect(deliveryAddressFromJson(null, "GH")).toBeNull();
    expect(deliveryAddressFromJson([], "GH")).toBeNull();
    expect(deliveryAddressFromJson({ landmark: "somewhere" }, "GH")).toBeNull();
  });
});

describe("orderDeliveryAddress", () => {
  it("prefers the normalised column and falls back to the snapshot", () => {
    const snapshot = { address: { line1: "Old St", city: "Accra" } };
    expect(orderDeliveryAddress({ delivery_address: { line1: "New St", city: "Tema" }, buyer_snapshot: snapshot }, "GH")?.city).toBe("Tema");
    expect(orderDeliveryAddress({ delivery_address: null, buyer_snapshot: snapshot }, "GH")?.line1).toBe("Old St");
    expect(orderDeliveryAddress({ buyer_snapshot: {} }, "GH")).toBeNull();
  });
});

describe("formatting", () => {
  it("joins the classic fields", () => {
    const address = deliveryAddressFromJson({ line1: "4 Palm St", area: "Labone", city: "Accra" }, "GH");
    expect(address && formatDeliveryAddressLine(address)).toBe("4 Palm St, Labone, Accra");
  });

  it("builds a map link only from a complete pin", () => {
    expect(deliveryMapUrl({ lat: 5.6, lng: -0.18 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=5.600000,-0.180000",
    );
    expect(deliveryMapUrl({ lat: 5.6, lng: null })).toBeNull();
  });
});
