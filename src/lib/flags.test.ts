import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { flagSnapshot, isFeatureEnabled } from "./flags";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFeatureEnabled", () => {
  it("passes scope through to the SQL evaluator", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(isFeatureEnabled("protect", { sellerAccountId: "s1", country: "GH" })).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("evaluate_feature_flag", {
      p_key: "protect",
      p_seller_account_id: "s1",
      p_country: "GH",
    });
  });

  it("fails closed when the lookup errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(isFeatureEnabled("protect")).resolves.toBe(false);
  });
});

describe("flagSnapshot", () => {
  it("resolves every static flag for the seller", async () => {
    mocks.rpc.mockImplementation(async (_fn: string, args: { p_key: string }) => ({
      data: args.p_key === "snap_to_list",
      error: null,
    }));
    const snapshot = await flagSnapshot("s1");
    expect(snapshot.snap_to_list).toBe(true);
    expect(snapshot.protect).toBe(false);
  });
});
