import { describe, expect, test } from "vitest";
import { canDeliverMarketing } from "./eligibility";
describe("marketing eligibility", () => {
  test("rechecks consent and frequency at delivery time", () => {
    expect(canDeliverMarketing({ consent: "withdrawn", sentLast30Days: 0, cap: 4 })).toBe(false);
    expect(canDeliverMarketing({ consent: "granted", sentLast30Days: 4, cap: 4 })).toBe(false);
    expect(canDeliverMarketing({ consent: "granted", sentLast30Days: 1, cap: 4 })).toBe(true);
  });
});
