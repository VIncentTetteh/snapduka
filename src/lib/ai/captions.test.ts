import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), isFeatureEnabled: vi.fn(), product: vi.fn(), modelCaller: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("./client", () => ({
  AI_MODELS: { fast: "claude-haiku-4-5-20251001" },
  cachedSystem: (text: string) => [{ type: "text", text }],
  modelCaller: (options: unknown) => {
    mocks.modelCaller(options);
    return mocks.call;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: mocks.product };
      return chain;
    },
  }),
}));

import { acceptableCaptions, suggestCaptions } from "./captions";
import { textReply } from "./testing";

const INPUT = { sellerAccountId: "s1", productId: "0f000000-0000-4000-8000-000000000001", channel: "instagram" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.product.mockResolvedValue({
    data: { name: "Shea butter", description: "Raw", price_minor: 8000, compare_at_price_minor: null, currency: "GHS" },
  });
});

describe("suggestCaptions", () => {
  it("returns the model's captions, bound to the seller's budget on Haiku", async () => {
    mocks.call.mockResolvedValue(textReply(JSON.stringify({ captions: ["Soft skin, naturally 🌿", "Raw shea for GH₵80.00", "Your new favourite"] })));
    await expect(suggestCaptions(INPUT)).resolves.toEqual({
      ok: true,
      captions: ["Soft skin, naturally 🌿", "Raw shea for GH₵80.00", "Your new favourite"],
    });
    expect(mocks.modelCaller).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAccountId: "s1", purpose: "share.captions", model: "claude-haiku-4-5-20251001" }),
    );
  });

  it("drops captions with an invented price or a link", async () => {
    mocks.call.mockResolvedValue(
      textReply(JSON.stringify({ captions: ["Only GH₵50 today!", "Shop at snapduka.com/x", "Glow up with shea"] })),
    );
    await expect(suggestCaptions(INPUT)).resolves.toEqual({ ok: true, captions: ["Glow up with shea"] });
  });

  it("is off without the ai_captions flag", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await expect(suggestCaptions(INPUT)).resolves.toMatchObject({ ok: false, reason: "not_enabled" });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("is not_found for another seller's product", async () => {
    mocks.product.mockResolvedValue({ data: null });
    await expect(suggestCaptions(INPUT)).resolves.toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("acceptableCaptions", () => {
  it("allows the compare-at price too", () => {
    expect(acceptableCaptions(["Was GH₵100.00, now GH₵80.00"], ["GH₵80.00", "GH₵100.00"])).toHaveLength(1);
  });
});
