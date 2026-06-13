import { describe, expect, test } from "vitest";
import { matchesSegment } from "./segments";
describe("customer segments", () => {
  test("matches deterministic aggregate rules", () => {
    expect(matchesSegment({ orderCount: 3, totalMinor: 9000, lastOrderAt: "2026-06-01" }, { minimumOrders: 2, minimumSpendMinor: 5000 }, new Date("2026-06-13"))).toBe(true);
  });
});
