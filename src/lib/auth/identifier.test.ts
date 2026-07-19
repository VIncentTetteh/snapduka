import { describe, expect, it } from "vitest";

import { classifyIdentifier } from "./identifier";

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
