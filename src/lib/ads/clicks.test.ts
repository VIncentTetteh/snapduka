import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  product: null as Record<string, unknown> | null,
  isFeatureEnabled: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: mocks.product, error: null });
      return builder;
    },
  }),
}));

import { encodeClickToken } from "./click-token";
import { handleAdClick } from "./clicks";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const HUMAN_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function request(overrides: Partial<Parameters<typeof handleAdClick>[0]> = {}) {
  return {
    token: encodeClickToken({
      campaignId: CAMPAIGN, productId: PRODUCT, priceMinor: 201, placement: "discover",
      issuedAt: Math.floor(Date.now() / 1000),
    }),
    ip: "102.176.1.1",
    userAgent: HUMAN_UA,
    purpose: null,
    secPurpose: null,
    secFetchMode: "navigate",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.product = { id: PRODUCT, seller_account_id: "s1", shops: { slug: "ama-shop" } };
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.rpc.mockResolvedValue({ data: "billed", error: null });
});

describe("handleAdClick", () => {
  it("bills a verified human click at the signed price and sends them to the product", async () => {
    expect(await handleAdClick(request())).toEqual({ destination: `/ama-shop/products/${PRODUCT}`, outcome: "billed" });
    expect(mocks.rpc).toHaveBeenCalledWith("record_ad_click", expect.objectContaining({
      p_campaign_id: CAMPAIGN, p_product_id: PRODUCT, p_price_minor: 201, p_placement: "discover",
    }));
  });

  it("keys the viewer on IP + user agent, never on a client-chosen cookie", async () => {
    await handleAdClick(request());
    await handleAdClick(request());
    const keys = mocks.rpc.mock.calls.map((call) => (call[1] as { p_viewer_key: string }).p_viewer_key);
    expect(keys[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(keys[0]).toBe(keys[1]);
  });

  it("does not bill a forged or expired token, but still redirects", async () => {
    expect(await handleAdClick(request({ token: "forged.token" }))).toEqual({ destination: "/discover", outcome: "invalid" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not bill link-preview crawlers or prefetches", async () => {
    expect((await handleAdClick(request({ userAgent: "WhatsApp/2.23" }))).outcome).toBe("bot");
    expect((await handleAdClick(request({ secPurpose: "prefetch" }))).outcome).toBe("bot");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not bill past the per-IP limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });
    expect((await handleAdClick(request())).outcome).toBe("rate_limited");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("stops billing links already on screen when the seller's flag goes off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect((await handleAdClick(request())).outcome).toBe("inactive");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never lets a billing error break the redirect", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect(await handleAdClick(request())).toEqual({ destination: `/ama-shop/products/${PRODUCT}`, outcome: "error" });
  });
});
