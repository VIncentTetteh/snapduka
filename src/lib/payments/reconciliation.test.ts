import { describe, expect, test } from "vitest";
import { classifySettlement } from "./reconciliation";
describe("settlement reconciliation", () => {
  test("classifies missing and amount mismatches", () => {
    expect(classifySettlement({ expectedMinor: 1000, receivedMinor: null })).toBe("missing");
    expect(classifySettlement({ expectedMinor: 1000, receivedMinor: 900 })).toBe("amount_mismatch");
    expect(classifySettlement({ expectedMinor: 1000, receivedMinor: 1000 })).toBe("matched");
  });
});
