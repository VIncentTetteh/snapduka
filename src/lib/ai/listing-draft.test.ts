import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  modelCaller: vi.fn(),
  isFeatureEnabled: vi.fn(),
  shop: vi.fn(),
  categories: vi.fn(),
  download: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("./client", () => ({
  AI_MODELS: { vision: "claude-sonnet-5" },
  cachedSystem: (text: string) => [{ type: "text", text, cache_control: { type: "ephemeral" } }],
  modelCaller: (options: unknown) => {
    mocks.modelCaller(options);
    return mocks.call;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "shops") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.shop }) }) };
      }
      return {
        select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: mocks.categories }) }) }) }),
      };
    },
    storage: { from: () => ({ download: mocks.download }) },
    rpc: mocks.rpc,
  }),
}));

import { textReply } from "./testing";
import {
  createListingDraft,
  isOwnStoragePath,
  listingSystemPrompt,
  priceExplanation,
} from "./listing-draft";

const SELLER = "11111111-1111-4111-8111-111111111111";
const CATEGORY = { id: "22222222-2222-4222-8222-222222222222", name: "Skincare" };
const PNG = Buffer.from("fake-png-bytes").toString("base64");

const MODEL_DRAFT = {
  title: "Raw shea butter, 500g tub",
  description: "Unrefined shea butter in a plain tub.",
  descriptionLocal: null,
  categoryId: CATEGORY.id,
  attributes: { colour: "ivory" },
  variantSuggestions: [],
  tags: ["Shea", "skincare"],
  // The model is told not to price; if it does anyway, the value is ignored.
  price: 99999,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.shop.mockResolvedValue({ data: { country: "GH", currency: "GHS" } });
  mocks.categories.mockResolvedValue({ data: [CATEGORY], error: null });
  mocks.call.mockResolvedValue(textReply(JSON.stringify(MODEL_DRAFT)));
  mocks.rpc.mockResolvedValue({
    data: [{ currency: "GHS", sample_size: 12, p25_minor: 4000, median_minor: 5000, p75_minor: 7000 }],
    error: null,
  });
});

describe("createListingDraft", () => {
  it("returns a draft with the category from the taxonomy and a SQL price", async () => {
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "base64", data: PNG, mediaType: "image/png" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      title: "Raw shea butter, 500g tub",
      category: CATEGORY,
      tags: ["shea", "skincare"],
      status: "draft",
      price: { currency: "GHS", sampleSize: 12, medianMinor: 5000, p25Minor: 4000, p75Minor: 7000 },
    });
    expect(result.draft.price.explanation).toMatch(/12 active Skincare listings in Ghana/);
    expect(mocks.rpc).toHaveBeenCalledWith("suggest_price", { p_category_id: CATEGORY.id, p_country: "GH" });
    expect(mocks.modelCaller).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAccountId: SELLER, purpose: "listing_draft" }),
    );
  });

  it("puts the taxonomy in a cached system prompt and the image in the user turn", async () => {
    await createListingDraft({ sellerAccountId: SELLER, image: { kind: "base64", data: PNG, mediaType: "image/png" } });

    const request = mocks.call.mock.calls[0][0];
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(request.system[0].text).toContain(`${CATEGORY.id} | Skincare`);
    expect(request.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG },
    });
  });

  it("drops a category id that is not in the taxonomy", async () => {
    mocks.call.mockResolvedValue(textReply(JSON.stringify({ ...MODEL_DRAFT, categoryId: "made-up" })));

    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "base64", data: PNG, mediaType: "image/png" },
    });

    expect(result.ok && result.draft.category).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.ok && result.draft.price.medianMinor).toBeNull();
  });

  it("is off unless the snap_to_list flag is on, and spends nothing", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "base64", data: PNG, mediaType: "image/png" },
    });
    expect(result).toMatchObject({ ok: false, reason: "not_enabled" });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("refuses a storage path outside the seller's own folder", async () => {
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "storage", path: "33333333-3333-4333-8333-333333333333/p/i.jpg" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_image" });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("reads an uploaded photo from storage", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([Buffer.from("jpeg")], { type: "image/jpeg" }), error: null });
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "storage", path: `${SELLER}/p/i.jpg` },
    });
    expect(result.ok).toBe(true);
    expect(mocks.call.mock.calls[0][0].messages[0].content[0].source.media_type).toBe("image/jpeg");
  });

  it("rejects an oversized inline photo before calling the model", async () => {
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "base64", data: "A".repeat(5_200_000), mediaType: "image/png" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_image" });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", "not_configured"],
    ["budget_exceeded", "budget_exceeded"],
    ["error", "failed"],
  ])("maps a %s model failure to %s", async (reason, expected) => {
    mocks.call.mockResolvedValue({ ok: false, reason });
    const result = await createListingDraft({
      sellerAccountId: SELLER,
      image: { kind: "base64", data: PNG, mediaType: "image/png" },
    });
    expect(result).toMatchObject({ ok: false, reason: expected });
  });
});

describe("isOwnStoragePath", () => {
  it.each([
    [`${SELLER}/p/i.jpg`, true],
    [`${SELLER}/../other/i.jpg`, false],
    [`other/${SELLER}/i.jpg`, false],
    [`${SELLER}//i.jpg`, false],
  ])("%s -> %s", (path, expected) => {
    expect(isOwnStoragePath(SELLER, path)).toBe(expected);
  });
});

describe("prompt and explanation", () => {
  it("keeps the system prompt free of anything per-request, so it caches", () => {
    expect(listingSystemPrompt([CATEGORY])).toBe(listingSystemPrompt([CATEGORY]));
    expect(listingSystemPrompt([CATEGORY])).toMatch(/Never state or suggest a price/);
  });

  it("says so when there is not enough data", () => {
    expect(
      priceExplanation({
        categoryName: "Skincare",
        country: "GH",
        currency: "GHS",
        sampleSize: 3,
        p25Minor: null,
        medianMinor: null,
        p75Minor: null,
      }),
    ).toMatch(/Not enough Skincare listings in Ghana/);
  });
});
