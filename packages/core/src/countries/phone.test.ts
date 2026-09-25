import { describe, expect, it } from "vitest";

import { isValidPhoneForCountry, phoneExampleFor } from "./phone";

describe("isValidPhoneForCountry", () => {
  it("accepts a 9-digit Ghana mobile number after +233", () => {
    expect(isValidPhoneForCountry("+233241234567", "GH")).toBe(true);
  });

  it("rejects a Ghana number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+23324123456", "GH")).toBe(false); // 8 digits
    expect(isValidPhoneForCountry("+2332412345678", "GH")).toBe(false); // 10 digits
  });

  it("accepts a 10-digit Nigeria mobile number after +234", () => {
    expect(isValidPhoneForCountry("+2348012345678", "NG")).toBe(true);
  });

  it("rejects a Nigeria number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+234801234567", "NG")).toBe(false); // 9 digits
  });

  it("accepts a 10-digit Côte d'Ivoire mobile number after +225", () => {
    expect(isValidPhoneForCountry("+2250708091011", "CI")).toBe(true);
  });

  it("rejects a Côte d'Ivoire number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+225070809101", "CI")).toBe(false); // 9 digits
  });

  it("rejects a number normalized for the wrong country's calling code", () => {
    expect(isValidPhoneForCountry("+234241234567", "GH")).toBe(false);
  });

  it("rejects garbage input instead of throwing", () => {
    expect(isValidPhoneForCountry("not a phone number", "GH")).toBe(false);
  });
});

describe("phoneExampleFor", () => {
  it("returns a plausible example per country", () => {
    expect(phoneExampleFor("GH")).toBe("+233241234567");
    expect(phoneExampleFor("NG")).toBe("+2348012345678");
    expect(phoneExampleFor("CI")).toBe("+2250708091011");
  });
});
