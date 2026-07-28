import { describe, expect, it } from "vitest";

import {
  classifyIdentifier,
  isIdentifierMode,
  isPhoneRegion,
  normalizePhoneInput,
  validateEmailIdentifier,
  validateIdentifier,
  validatePhoneIdentifier,
} from "./identifier";

describe("validateEmailIdentifier", () => {
  it("accepts and normalizes a valid address", () => {
    expect(validateEmailIdentifier("  Seller@Example.COM ")).toEqual({
      ok: true,
      kind: "email",
      value: "seller@example.com",
    });
  });

  it("asks for a value when empty rather than calling it invalid", () => {
    expect(validateEmailIdentifier("   ")).toEqual({
      ok: false,
      message: "Enter your email address.",
    });
  });

  it.each(["not-an-email@", "no-at-sign.com", "spaces in@example.com", "+233241234567"])(
    "rejects %s with a specific message",
    (input) => {
      const result = validateEmailIdentifier(input);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain("you@example.com");
    },
  );
});

describe("normalizePhoneInput", () => {
  it.each([
    ["241234567", "GH", "+233241234567"],
    ["0241234567", "GH", "+233241234567"],
    ["024 123 4567", "GH", "+233241234567"],
    ["(024) 123-4567", "GH", "+233241234567"],
    ["+233241234567", "GH", "+233241234567"],
    ["08012345678", "NG", "+2348012345678"],
  ] as const)("folds %s (%s) to %s", (input, region, expected) => {
    expect(normalizePhoneInput(input, region)).toBe(expected);
  });

  it("keeps an explicit + even when it disagrees with the selected region", () => {
    // Someone selects Ghana then pastes a Nigerian number: validate what they
    // actually typed instead of silently prefixing +233 onto it.
    expect(normalizePhoneInput("+2348012345678", "GH")).toBe("+2348012345678");
  });

  it("does not invent a calling code for OTHER", () => {
    expect(normalizePhoneInput("0712345678", "OTHER")).toBe("0712345678");
  });
});

describe("validatePhoneIdentifier", () => {
  it("accepts a correct Ghana number typed locally", () => {
    expect(validatePhoneIdentifier("024 123 4567", "GH")).toEqual({
      ok: true,
      kind: "phone",
      value: "+233241234567",
    });
  });

  it("accepts a correct Nigeria number", () => {
    expect(validatePhoneIdentifier("08012345678", "NG")).toEqual({
      ok: true,
      kind: "phone",
      value: "+2348012345678",
    });
  });

  it("names the country, digit count and an example when the length is wrong", () => {
    const result = validatePhoneIdentifier("24123456", "GH");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      "Ghana numbers have 9 digits after +233. Example: +233241234567",
    );
  });

  it("rejects a Nigeria-length number submitted under Ghana", () => {
    expect(validatePhoneIdentifier("+2348012345678", "GH").ok).toBe(false);
  });

  it("asks for a value when empty", () => {
    expect(validatePhoneIdentifier("  ", "GH")).toEqual({
      ok: false,
      message: "Enter your phone number.",
    });
  });

  it("accepts any E.164 number under OTHER", () => {
    expect(validatePhoneIdentifier("+254712345678", "OTHER")).toEqual({
      ok: true,
      kind: "phone",
      value: "+254712345678",
    });
  });

  it("requires an explicit + under OTHER", () => {
    const result = validatePhoneIdentifier("0712345678", "OTHER");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("international format");
  });
});

describe("validateIdentifier dispatch", () => {
  it("routes by mode, not by guessing at the value", () => {
    // A phone number on the email tab must fail as an email — the whole point
    // of the tabs is that the user has told us which one they meant.
    expect(validateIdentifier("email", "+233241234567").ok).toBe(false);
    expect(validateIdentifier("phone", "0241234567", "GH").ok).toBe(true);
  });
});

describe("untrusted field guards", () => {
  it.each(["email", "phone"])("accepts the real mode %s", (mode) => {
    expect(isIdentifierMode(mode)).toBe(true);
  });

  it.each(["", "admin", "EMAIL", "sms"])("rejects tampered mode %s", (mode) => {
    expect(isIdentifierMode(mode)).toBe(false);
  });

  it.each(["GH", "NG", "CI", "OTHER"])("accepts the real region %s", (region) => {
    expect(isPhoneRegion(region)).toBe(true);
  });

  it.each(["", "US", "gh", "'; drop table"])("rejects tampered region %s", (region) => {
    expect(isPhoneRegion(region)).toBe(false);
  });
});

describe("classifyIdentifier", () => {
  it("classifies a valid email, lowercased and trimmed", () => {
    expect(classifyIdentifier("  Seller@Example.com  ")).toEqual({
      kind: "email",
      value: "seller@example.com",
    });
  });

  it("classifies a valid E.164 phone number", () => {
    expect(classifyIdentifier("+233241234567")).toEqual({
      kind: "phone",
      value: "+233241234567",
    });
  });

  it("strips spaces and dashes from a phone number before classifying", () => {
    expect(classifyIdentifier("+233 24-123-4567")).toEqual({
      kind: "phone",
      value: "+233241234567",
    });
  });

  it("rejects an invalid email", () => {
    expect(classifyIdentifier("not-an-email@")).toEqual({ kind: "invalid" });
  });

  it("rejects a phone number with no country code", () => {
    expect(classifyIdentifier("0241234567")).toEqual({ kind: "invalid" });
  });

  it("rejects an empty string", () => {
    expect(classifyIdentifier("   ")).toEqual({ kind: "invalid" });
  });

  it("rejects gibberish that is neither an email nor a phone number", () => {
    expect(classifyIdentifier("hello world")).toEqual({ kind: "invalid" });
  });
});
