import { describe, expect, it } from "vitest";
import { planChangeKind } from "./tiers";

/**
 * Whether a move is an upgrade is not cosmetic: upgrades are charged now,
 * downgrades wait for the end of the paid period so the seller keeps what they
 * bought. Labelling one as the other in the app promises the wrong thing.
 */
describe("planChangeKind", () => {
  it("reads a move up the tiers as an upgrade", () => {
    expect(planChangeKind({ currentCode: "free", targetCode: "growth" })).toBe("upgrade");
    expect(planChangeKind({ currentCode: "growth", targetCode: "scale" })).toBe("upgrade");
    expect(planChangeKind({ currentCode: "free", targetCode: "scale" })).toBe("upgrade");
  });

  it("reads a move down the tiers as a downgrade", () => {
    expect(planChangeKind({ currentCode: "scale", targetCode: "growth" })).toBe("downgrade");
    expect(planChangeKind({ currentCode: "growth", targetCode: "free" })).toBe("downgrade");
  });

  it("reports the same plan and interval as current", () => {
    expect(planChangeKind({ currentCode: "growth", targetCode: "growth" })).toBe("current");
  });

  it("treats monthly to yearly on the same plan as an upgrade", () => {
    // The bigger commitment, charged immediately — the case a price comparison
    // alone would get wrong, since the tier has not moved.
    expect(
      planChangeKind({
        currentCode: "growth",
        targetCode: "growth",
        currentInterval: "monthly",
        targetInterval: "yearly",
      }),
    ).toBe("upgrade");
  });

  it("treats yearly to monthly on the same plan as a downgrade", () => {
    // Must not refund the rest of a paid year, so it is scheduled, not charged.
    expect(
      planChangeKind({
        currentCode: "growth",
        targetCode: "growth",
        currentInterval: "yearly",
        targetInterval: "monthly",
      }),
    ).toBe("downgrade");
  });

  it("accepts 'annually' as the same commitment as 'yearly'", () => {
    expect(
      planChangeKind({
        currentCode: "growth",
        targetCode: "growth",
        currentInterval: "annually",
        targetInterval: "yearly",
      }),
    ).toBe("current");
  });

  it("treats an unknown plan code as the bottom tier rather than throwing", () => {
    // A plan added on the web before the app knows about it must not crash the
    // billing screen; showing it as an upgrade is the safe reading.
    expect(planChangeKind({ currentCode: "free", targetCode: "enterprise" })).toBe("current");
    expect(planChangeKind({ currentCode: "scale", targetCode: "enterprise" })).toBe("downgrade");
  });
});
