import { describe, expect, it } from "vitest";

import {
  validateAmount,
  validateEmail,
  validateName,
  validatePhone,
  validateRequired,
  validateWholeNumber,
} from "./validation";

describe("validateEmail", () => {
  it("accepts valid emails and rejects malformed ones", () => {
    expect(validateEmail("ama@example.com")).toBeNull();
    expect(validateEmail("")).toMatch(/enter your email/i);
    expect(validateEmail("not-an-email")).toMatch(/valid email/i);
  });
});

describe("validatePhone", () => {
  it("accepts Ghanaian formats with and without country code", () => {
    expect(validatePhone("0241234567", "GH")).toBeNull();
    expect(validatePhone("+233241234567", "GH")).toBeNull();
    expect(validatePhone("024 123 4567", "GH")).toBeNull();
  });

  it("accepts Nigerian and Ivorian formats", () => {
    expect(validatePhone("08012345678", "NG")).toBeNull();
    expect(validatePhone("+2348012345678", "NG")).toBeNull();
    expect(validatePhone("0708091011", "CI")).toBeNull();
  });

  it("rejects wrong lengths with a country-specific example", () => {
    expect(validatePhone("024123", "GH")).toMatch(/024 123 4567/);
    expect(validatePhone("12345", "NG")).toMatch(/0801 234 5678/);
    expect(validatePhone("", "GH")).toMatch(/enter your phone/i);
  });
});

describe("validateName / validateRequired", () => {
  it("requires at least two characters", () => {
    expect(validateName("Ama")).toBeNull();
    expect(validateName(" a ")).toMatch(/at least 2/);
  });

  it("returns the given message when blank", () => {
    expect(validateRequired("  ", "Enter your address.")).toBe("Enter your address.");
    expect(validateRequired("14 Kofi Annan Ave", "Enter your address.")).toBeNull();
  });
});

describe("amount and number validation", () => {
  it("accepts decimals for GHS but whole numbers only for XOF", () => {
    expect(validateAmount("240.50", "GHS")).toBeNull();
    expect(validateAmount("12000", "XOF")).toBeNull();
    expect(validateAmount("120.5", "XOF")).toMatch(/whole numbers/i);
    expect(validateAmount("0", "GHS")).toMatch(/greater than zero/i);
    expect(validateAmount("abc", "GHS")).toMatch(/greater than zero/i);
  });

  it("validates whole numbers for stock", () => {
    expect(validateWholeNumber("10", "stock quantity")).toBeNull();
    expect(validateWholeNumber("1.5", "stock quantity")).toMatch(/whole number/);
    expect(validateWholeNumber("", "stock quantity")).toMatch(/enter a/i);
  });
});
