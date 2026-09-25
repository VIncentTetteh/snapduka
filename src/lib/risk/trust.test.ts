// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) builder[method] = () => builder;
      builder.maybeSingle = () => Promise.resolve(mocks.tables[table] ?? { data: null, error: null });
      return builder;
    },
  }),
}));

import { getStorefrontTrustTier, getTrustTier, isPublicTrustTier } from "./trust";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.tables = {
    shops: { data: { seller_account_id: "seller-1", country: "GH" }, error: null },
    seller_trust_scores: {
      data: { tier: "silver", score: 71, computed_at: "2026-09-25T04:40:00Z", weights_version: "v1" },
      error: null,
    },
  };
});

describe("getTrustTier", () => {
  it("returns the full answer for money code, with no flag check", async () => {
    expect(await getTrustTier("seller-1")).toEqual({
      tier: "silver",
      score: 71,
      computedAt: "2026-09-25T04:40:00Z",
      weightsVersion: "v1",
    });
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("returns null for a seller never scored", async () => {
    mocks.tables.seller_trust_scores = { data: null, error: null };
    expect(await getTrustTier("seller-1")).toBeNull();
  });
});

describe("getStorefrontTrustTier", () => {
  it("shows a public tier while the flag is on", async () => {
    expect(await getStorefrontTrustTier("shop-a")).toBe("silver");
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("trust_score", { sellerAccountId: "seller-1", country: "GH" });
  });

  it("shows nothing while the flag is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await getStorefrontTrustTier("shop-b")).toBeNull();
  });

  it("never shows new or watch to a buyer", async () => {
    mocks.tables.seller_trust_scores.data = { tier: "watch", score: 20, computed_at: "x", weights_version: "v1" };
    expect(await getStorefrontTrustTier("shop-c")).toBeNull();
    expect(isPublicTrustTier("new")).toBe(false);
  });

  it("shows nothing rather than failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.isFeatureEnabled.mockRejectedValue(new Error("no key"));
    expect(await getStorefrontTrustTier("shop-d")).toBeNull();
  });
});
