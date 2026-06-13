import { describe, expect, it } from "vitest";

import { getCountryConfig } from "./config";

describe("getCountryConfig", () => {
  it("returns Ghana's currency and calling code", () => {
    expect(getCountryConfig("GH")).toMatchObject({
      code: "GH",
      currency: "GHS",
      callingCode: "+233",
    });
  });

  it("returns Nigeria's currency and calling code", () => {
    expect(getCountryConfig("NG")).toMatchObject({
      code: "NG",
      currency: "NGN",
      callingCode: "+234",
    });
  });

  it("rejects unsupported countries instead of falling back", () => {
    for (const countryCode of ["US", "toString"]) {
      expect(() => getCountryConfig(countryCode)).toThrowError(
        `Unsupported country code: ${countryCode}`,
      );
    }
  });
});
