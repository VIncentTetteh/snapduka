import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/onboarding?step=shop#identity")).toBe(
      "/onboarding?step=shop#identity",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "dashboard",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
  ])("rejects unsafe redirect value %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});
