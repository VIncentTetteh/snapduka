import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), isFeatureEnabled: vi.fn(), bnplStatus: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: () => ({}) }));
vi.mock("@/lib/bnpl/registry", () => ({
  getActiveBnplProvider: () => ({ id: "sandbox", status: mocks.bnplStatus }),
}));

import { routeCheckout } from "./router";

const GH = { country: "GH" as const, currency: "GHS" as const, sellerAccountId: "s1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.isFeatureEnabled.mockResolvedValue(false);
  mocks.bnplStatus.mockReturnValue("not_configured");
});
afterEach(() => vi.unstubAllEnvs());

describe("routeCheckout", () => {
  it("routes Ghana to Paystack when it is the only configured provider", async () => {
    const routes = await routeCheckout(GH);
    expect(routes.map((r) => [r.provider.id, r.reason])).toEqual([["paystack", "preferred"]]);
  });

  it("offers a configured, flagged second provider as the fallback", async () => {
    vi.stubEnv("HUBTEL_CLIENT_ID", "id");
    vi.stubEnv("HUBTEL_CLIENT_SECRET", "secret");
    vi.stubEnv("HUBTEL_MERCHANT_ACCOUNT", "acct");
    mocks.isFeatureEnabled.mockResolvedValue(true);
    const routes = await routeCheckout(GH);
    expect(routes.map((r) => [r.provider.id, r.reason])).toEqual([
      ["paystack", "preferred"],
      ["hubtel", "fallback"],
    ]);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("provider:hubtel", { sellerAccountId: "s1" });
  });

  it("skips a provider whose circuit is open", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await routeCheckout(GH)).toEqual([]);
  });

  it("keeps checkout up if the health lookup itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await routeCheckout(GH)).map((r) => r.provider.id)).toEqual(["paystack"]);
  });

  it("offers nothing online for a currency no provider serves", async () => {
    expect(await routeCheckout({ country: "CI", currency: "XOF", sellerAccountId: "s1" })).toEqual([]);
  });

  describe("buy now, pay later", () => {
    it("is never a candidate for an ordinary card/MoMo checkout, even when configured and flagged", async () => {
      mocks.bnplStatus.mockReturnValue("ready");
      mocks.isFeatureEnabled.mockResolvedValue(true);
      expect((await routeCheckout(GH)).map((r) => r.provider.id)).toEqual(["paystack"]);
    });

    it("routes a buyer who chose it to the BNPL partner, behind the bnpl flag", async () => {
      mocks.bnplStatus.mockReturnValue("ready");
      mocks.isFeatureEnabled.mockResolvedValue(true);
      const routes = await routeCheckout({ ...GH, method: "bnpl" });
      expect(routes.map((r) => r.provider.id)).toEqual(["bnpl"]);
      expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("bnpl", { sellerAccountId: "s1" });
    });

    it("offers nothing when the flag is off or no partner is configured", async () => {
      mocks.bnplStatus.mockReturnValue("ready");
      expect(await routeCheckout({ ...GH, method: "bnpl" })).toEqual([]);
      mocks.isFeatureEnabled.mockResolvedValue(true);
      mocks.bnplStatus.mockReturnValue("not_configured");
      expect(await routeCheckout({ ...GH, method: "bnpl" })).toEqual([]);
    });
  });
});
