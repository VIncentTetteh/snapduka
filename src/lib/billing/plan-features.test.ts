import { describe, expect, it } from "vitest";

import { planFeatureBullets, planUpgradeBullets } from "./plan-features";

const FREE = {
  shops: 1,
  products: 50,
  staffAccounts: 1,
  campaigns: true,
  discovery: true,
  promotions: false,
  branding: false,
  customDomain: false,
  exports: false,
  customerSegments: 3,
  broadcastsPerMonth: 0,
  automationRules: 0,
  apiKeys: 0,
  creatorProgram: false,
  creatorPartnerships: 0,
};

const GROWTH = {
  ...FREE,
  products: 500,
  staffAccounts: 3,
  promotions: true,
  branding: true,
  customDomain: true,
  exports: true,
  customerSegments: 20,
  broadcastsPerMonth: 10,
  automationRules: 10,
  apiKeys: 2,
  creatorProgram: true,
  creatorPartnerships: 5,
  courierIntegrations: true,
};

describe("planFeatureBullets", () => {
  it("describes the free plan from its entitlements", () => {
    expect(planFeatureBullets(FREE, { customDomains: true })).toEqual([
      "Up to 50 products",
      "Owner account only",
      "Tracked share links",
      "3 customer segments",
      "Discovery listing",
    ]);
  });

  it("never sells custom domains while they are not connected", () => {
    expect(planFeatureBullets(GROWTH, { customDomains: false })).not.toContain("Custom domain");
    expect(planFeatureBullets(GROWTH, { customDomains: true })).toContain("Custom domain");
  });

  it("leaves out entitlements no code enforces", () => {
    expect(planFeatureBullets(GROWTH, { customDomains: true }).join(" ")).not.toMatch(/courier/i);
  });
});

describe("planUpgradeBullets", () => {
  it("lists only what the plan adds, including raised limits", () => {
    const added = planUpgradeBullets(FREE, GROWTH, { customDomains: false });
    expect(added).toContain("Up to 500 products");
    expect(added).toContain("3 staff accounts");
    expect(added).toContain("Discount promotions");
    expect(added).not.toContain("Tracked share links");
    expect(added).not.toContain("Discovery listing");
  });
});
