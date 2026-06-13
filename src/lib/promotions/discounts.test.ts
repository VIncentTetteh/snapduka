import { describe, expect, test } from "vitest";
import { calculateDiscount } from "./discounts";

describe("discounts", () => {
  test("caps percentages and honors minimum order values", () => {
    expect(calculateDiscount({ kind: "percentage", value: 20, maximumMinor: 1500, minimumMinor: 5000 }, 10_000)).toBe(1500);
    expect(calculateDiscount({ kind: "fixed", value: 1000, minimumMinor: 5000 }, 4000)).toBe(0);
  });
});
