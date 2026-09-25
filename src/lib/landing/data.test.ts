import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(), config: {} as Record<string, unknown>, plans: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = async () => ({ data: mocks.plans });
      chain.maybeSingle = async () => ({ data: table === "country_configs" ? mocks.config : null });
      return chain;
    },
  }),
}));

import { getLandingData, visitorCountry } from "./data";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = { currency: "GHS", platform_fee_bps: 700, protect_enabled: true, protect_fee_bps: 150, protect_fee_min_minor: 100, protect_fee_cap_minor: 2000, instant_payout_fee_bps: 100, instant_payout_fee_min_minor: 100, protect_inspection_hours: 24, protect_auto_release_hours: 168 };
  mocks.plans = [
    { code: "growth", name: "Growth", entitlements: { products: 500, staffAccounts: 3, campaigns: true, promotions: true, customDomain: true }, plan_prices: [
      { country: "GH", interval: "monthly", amount_minor: 6000, active: true },
      { country: "GH", interval: "yearly", amount_minor: 60000, active: true },
      { country: "NG", interval: "monthly", amount_minor: 1000000, active: true },
    ] },
    { code: "free", name: "Free", entitlements: { products: 50, staffAccounts: 1, campaigns: true }, plan_prices: [] },
  ];
});

describe("visitorCountry", () => {
  it.each([
    ["GH", "GH"],
    ["ng", "NG"],
    ["CI", "CI"],
    ["US", "GH"],
    [null, "GH"],
  ])("maps %s to %s", (header, country) => {
    const headers = new Headers(header ? { "x-vercel-ip-country": header } : {});
    expect(visitorCountry(headers)).toBe(country);
  });
});

describe("getLandingData", () => {
  it("prices plans for the market's monthly interval and marks unsold plans", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    const data = await getLandingData("GH");
    expect(data.plans.map(({ code, monthlyMinor }) => ({ code, monthlyMinor }))).toEqual([
      { code: "free", monthlyMinor: 0 },
      { code: "growth", monthlyMinor: 6000 },
      { code: "scale", monthlyMinor: null },
    ]);
  });

  it("lists what each plan includes from its entitlements, paid plans as what they add", async () => {
    mocks.isFeatureEnabled.mockImplementation(async (key: string) => key !== "custom_domains");
    const [free, growth] = (await getLandingData("GH")).plans;
    expect(free!.features).toEqual(["Up to 50 products", "Owner account only", "Tracked share links"]);
    expect(growth!.features).toEqual(["Up to 500 products", "3 staff accounts", "Discount promotions"]);
  });

  it("sells custom domains only once they are switched on", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    expect((await getLandingData("GH")).plans[1]!.features).toContain("Custom domain");
  });

  it("treats Protect as live only with both the market switch and the flag", async () => {
    mocks.isFeatureEnabled.mockImplementation(async (key: string) => key !== "protect");
    expect((await getLandingData("GH")).features.protect).toBe(false);

    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.config.protect_enabled = false;
    expect((await getLandingData("GH")).features.protect).toBe(false);
  });

  it("evaluates feature flags for the visitor's country", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await getLandingData("NG");
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("snap_to_list", { country: "NG" });
  });
});
