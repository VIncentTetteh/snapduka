import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), isFeatureEnabled: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { decodeClickToken } from "./click-token";
import { getSponsoredListings } from "./sponsored";

const ROW = {
  campaign_id: "11111111-1111-4111-8111-111111111111",
  product_id: "22222222-2222-4222-8222-222222222222",
  seller_account_id: "33333333-3333-4333-8333-333333333333",
  product_name: "Kente scarf",
  price_minor: 15_000,
  currency: "GHS",
  shop_slug: "ama",
  shop_name: "Ama's",
  image_path: null,
  bid_minor: 300,
  cost_per_click_minor: 201,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: [ROW], error: null });
});

describe("getSponsoredListings", () => {
  it("shows nothing in a market where the flag is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await getSponsoredListings({ country: "GH", placement: "discover" })).toEqual([]);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("promoted_listings", { country: "GH" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("signs each slot's click link with the price it won at", async () => {
    const now = Date.now();
    const [listing] = await getSponsoredListings({ country: "GH", placement: "discover", now });
    expect(listing).toMatchObject({ productName: "Kente scarf", shopSlug: "ama", priceMinor: 15_000 });
    const token = new URL(listing.href, "https://x.test").searchParams.get("t");
    expect(decodeClickToken(token, now)).toMatchObject({
      campaignId: ROW.campaign_id, productId: ROW.product_id, priceMinor: 201, placement: "discover",
    });
  });

  it("never takes the directory down: an ads failure shows no ads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getSponsoredListings({ country: "GH", placement: "discover" })).toEqual([]);
    mocks.rpc.mockRejectedValue(new Error("network"));
    expect(await getSponsoredListings({ country: "GH", placement: "discover" })).toEqual([]);
  });
});
