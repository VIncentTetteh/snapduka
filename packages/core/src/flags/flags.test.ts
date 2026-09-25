import { describe, expect, it } from "vitest";

import { isFlagKey } from "./index";

describe("isFlagKey", () => {
  it("accepts registered and prefixed keys", () => {
    expect(isFlagKey("protect")).toBe(true);
    expect(isFlagKey("courier_booking:yango")).toBe(true);
    expect(isFlagKey("provider:hubtel")).toBe(true);
  });

  it("rejects typos and bare prefixes", () => {
    expect(isFlagKey("protec")).toBe(false);
    expect(isFlagKey("courier_booking:")).toBe(false);
  });
});
