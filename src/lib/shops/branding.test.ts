import { describe, expect, test } from "vitest";

import { parseBranding } from "./branding";

describe("shop branding", () => {
  test("accepts constrained colors and rejects unsafe CSS", () => {
    expect(parseBranding({ accent: "#146b45", surface: "#ffffff", font: "system" }).success).toBe(true);
    expect(parseBranding({ accent: "url(javascript:alert(1))", surface: "#fff", font: "system" }).success).toBe(false);
  });
});
