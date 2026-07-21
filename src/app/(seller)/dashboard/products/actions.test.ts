import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  parseVideoUrl: vi.fn(),
  fetchOembedThumbnail: vi.fn(),
  isSafeHttpUrl: vi.fn(),
  getSellerPlan: vi.fn(),
  withinPlanLimit: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/catalog/video", () => ({
  parseVideoUrl: mocks.parseVideoUrl,
  fetchOembedThumbnail: mocks.fetchOembedThumbnail,
  isSafeHttpUrl: mocks.isSafeHttpUrl,
}));

vi.mock("@/lib/billing/resolve", () => ({
  getSellerPlan: mocks.getSellerPlan,
  planLimit: vi.fn().mockReturnValue(50),
  withinPlanLimit: mocks.withinPlanLimit,
}));

import { createProductAction, setProductVideoAction, updateProductAction } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const SELLER_ACTOR = {
  kind: "seller" as const,
  authenticated: true,
  userId: "00000000-0000-0000-0000-000000000101",
  email: "seller@example.com",
  sellerAccountId: "00000000-0000-0000-0000-000000000201",
  country: "GH" as const,
  status: "active" as const,
};

describe("setProductVideoAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSafeHttpUrl.mockReturnValue(true);
  });

  it("rejects a javascript: URL without saving anything (stored XSS guard)", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.isSafeHttpUrl.mockReturnValue(false);

    const update = vi.fn();
    const from = vi.fn().mockReturnValue({ update });
    mocks.createClient.mockResolvedValue({ from });

    await setProductVideoAction(
      formData({ productId: "p1", videoUrl: "javascript:alert(document.cookie)" }),
    );

    expect(mocks.isSafeHttpUrl).toHaveBeenCalledWith("javascript:alert(document.cookie)");
    expect(mocks.parseVideoUrl).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("does nothing for a non-seller actor", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

    await setProductVideoAction(formData({ productId: "p1", videoUrl: "https://youtu.be/abc" }));

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does nothing for a suspended seller account", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      ...SELLER_ACTOR,
      status: "suspended",
    });

    await setProductVideoAction(formData({ productId: "p1", videoUrl: "https://youtu.be/abc" }));

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("saves a parsed YouTube URL with its deterministic thumbnail", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.parseVideoUrl.mockReturnValue({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });

    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ update });
    mocks.createClient.mockResolvedValue({ from });

    await setProductVideoAction(
      formData({ productId: "p1", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    );

    expect(mocks.fetchOembedThumbnail).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("products");
    expect(update).toHaveBeenCalledWith({
      video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      video_provider: "youtube",
      video_id: "dQw4w9WgXcQ",
      video_thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    expect(eq1).toHaveBeenCalledWith("id", "p1");
    expect(eq2).toHaveBeenCalledWith("seller_account_id", "00000000-0000-0000-0000-000000000201");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/products/p1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/products");
  });

  it("fetches an oEmbed thumbnail for a TikTok URL", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.parseVideoUrl.mockReturnValue({
      provider: "tiktok",
      videoId: "7123456789012345678",
      thumbnailUrl: null,
    });
    mocks.fetchOembedThumbnail.mockResolvedValue("https://p16.tiktokcdn.com/thumb.jpg");

    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ update });
    mocks.createClient.mockResolvedValue({ from });

    const url = "https://www.tiktok.com/@someuser/video/7123456789012345678";
    await setProductVideoAction(formData({ productId: "p1", videoUrl: url }));

    expect(mocks.fetchOembedThumbnail).toHaveBeenCalledWith("tiktok", url);
    expect(update).toHaveBeenCalledWith({
      video_url: url,
      video_provider: "tiktok",
      video_id: "7123456789012345678",
      video_thumbnail_url: "https://p16.tiktokcdn.com/thumb.jpg",
    });
  });

  it("clears all video columns when the URL field is empty", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);

    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ update });
    mocks.createClient.mockResolvedValue({ from });

    await setProductVideoAction(formData({ productId: "p1", videoUrl: "" }));

    expect(mocks.parseVideoUrl).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      video_url: null,
      video_provider: null,
      video_id: null,
      video_thumbnail_url: null,
    });
  });

  it("does nothing without a productId", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);

    await setProductVideoAction(formData({ videoUrl: "https://youtu.be/abc" }));

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("updateProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not update the product when the submitted currency doesn't match the shop currency", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);

    const single = vi.fn().mockResolvedValue({ data: { id: "shop1", currency: "GHS" } });
    const shopsEq = vi.fn().mockReturnValue({ single });
    const shopsSelect = vi.fn().mockReturnValue({ eq: shopsEq });
    const update = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === "shops") return { select: shopsSelect };
      if (table === "products") return { update };
      throw new Error(`unexpected table ${table}`);
    });
    mocks.createClient.mockResolvedValue({ from });

    await updateProductAction(
      formData({
        productId: "p1",
        name: "Test Product",
        description: "",
        price: "1000",
        currency: "NGN",
        inventoryPolicy: "continue_selling",
        stockQuantity: "",
        sku: "",
        status: "draft",
      }),
    );

    expect(shopsEq).toHaveBeenCalledWith("seller_account_id", SELLER_ACTOR.sellerAccountId);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * Builds a full success-path Supabase mock for createProductAction, which
 * (unlike the other actions in this file) touches three tables in one call:
 * `shops` (currency check), `products` (plan-limit count, then insert, then
 * — via the in-process uploadProductImageAction call — a lookup), and
 * `product_media` (image insert). `overrides.uploadError`/`mediaError` let
 * individual tests force a failure partway through the photo-upload path.
 */
function buildCreateProductSupabaseMock(
  overrides: { uploadError?: boolean; mediaError?: boolean } = {},
) {
  const shopSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: "shop-1", currency: "GHS" }, error: null });
  const shopEq = vi.fn().mockReturnValue({ single: shopSingle });
  const shopSelect = vi.fn().mockReturnValue({ eq: shopEq });

  // products.select("id", { count, head }).eq(...).neq(...) — plan-limit count query
  const countNeq = vi.fn().mockResolvedValue({ count: 0, error: null });
  const countEq = vi.fn().mockReturnValue({ neq: countNeq });

  // products.select("id").eq(...).eq(...).single() — uploadProductImageAction's own lookup
  const lookupSingle = vi.fn().mockResolvedValue({ data: { id: "product-1" } });
  const lookupEq2 = vi.fn().mockReturnValue({ single: lookupSingle });
  const lookupEq1 = vi.fn().mockReturnValue({ eq: lookupEq2 });

  const productsSelect = vi.fn((_column: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count) return { eq: countEq };
    return { eq: lookupEq1 };
  });

  const insertSingle = vi.fn().mockResolvedValue({ data: { id: "product-1" }, error: null });
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
  const productsInsert = vi.fn().mockReturnValue({ select: insertSelect });
  const productsDeleteEq = vi.fn().mockResolvedValue({});
  const productsDelete = vi.fn().mockReturnValue({ eq: productsDeleteEq });

  const mediaMaybeSingle = vi.fn().mockResolvedValue({ data: null });
  const mediaLimit = vi.fn().mockReturnValue({ maybeSingle: mediaMaybeSingle });
  const mediaOrder = vi.fn().mockReturnValue({ limit: mediaLimit });
  const mediaEq = vi.fn().mockReturnValue({ order: mediaOrder });
  const mediaSelect = vi.fn().mockReturnValue({ eq: mediaEq });
  const mediaInsert = vi
    .fn()
    .mockResolvedValue({ error: overrides.mediaError ? new Error("media insert failed") : null });

  const storageUpload = vi
    .fn()
    .mockResolvedValue({ error: overrides.uploadError ? new Error("upload failed") : null });
  const storageRemove = vi.fn().mockResolvedValue({});
  const storageFrom = vi.fn().mockReturnValue({ upload: storageUpload, remove: storageRemove });

  const from = vi.fn((table: string) => {
    if (table === "shops") return { select: shopSelect };
    if (table === "products") {
      return { select: productsSelect, insert: productsInsert, delete: productsDelete };
    }
    if (table === "product_media") return { select: mediaSelect, insert: mediaInsert };
    throw new Error(`unexpected table ${table}`);
  });

  return { from, storage: { from: storageFrom }, productsInsert, mediaInsert, storageUpload };
}

const CREATE_PRODUCT_REQUIRED_FIELDS = {
  name: "Test Product",
  description: "",
  price: "10000",
  currency: "GHS",
  inventoryPolicy: "continue_selling",
  stockQuantity: "",
  sku: "",
  status: "draft",
};

describe("createProductAction — cost, compare-at, video, and photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.getSellerPlan.mockResolvedValue({});
    mocks.withinPlanLimit.mockReturnValue(true);
    mocks.isSafeHttpUrl.mockReturnValue(true);
  });

  it("stores cost_minor and compare_at_price_minor on the inserted row", async () => {
    const { from, productsInsert } = buildCreateProductSupabaseMock();
    mocks.createClient.mockResolvedValue({ from, storage: { from: vi.fn() } });

    const state = await createProductAction(
      { status: "idle", values: {} },
      formData({
        ...CREATE_PRODUCT_REQUIRED_FIELDS,
        costPrice: "8000",
        compareAtPrice: "18000",
      }),
    );

    expect(productsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ cost_minor: 8000, compare_at_price_minor: 18000 }),
    );
    expect(state.status).toBe("success");
  });

  it("parses and stores video fields when a videoUrl is submitted", async () => {
    mocks.parseVideoUrl.mockReturnValue({
      provider: "youtube",
      videoId: "abc123",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    });

    const { from, productsInsert } = buildCreateProductSupabaseMock();
    mocks.createClient.mockResolvedValue({ from, storage: { from: vi.fn() } });

    const state = await createProductAction(
      { status: "idle", values: {} },
      formData({
        ...CREATE_PRODUCT_REQUIRED_FIELDS,
        videoUrl: "https://www.youtube.com/watch?v=abc123",
      }),
    );

    expect(productsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        video_url: "https://www.youtube.com/watch?v=abc123",
        video_provider: "youtube",
        video_id: "abc123",
        video_thumbnail_url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      }),
    );
    expect(mocks.fetchOembedThumbnail).not.toHaveBeenCalled();
    expect(state.status).toBe("success");
  });

  it("calls uploadProductImageAction with the created product's id when imageDataUrl is submitted", async () => {
    const { from, storage, storageUpload, mediaInsert } = buildCreateProductSupabaseMock();
    mocks.createClient.mockResolvedValue({ from, storage });

    const state = await createProductAction(
      { status: "idle", values: {} },
      formData({
        ...CREATE_PRODUCT_REQUIRED_FIELDS,
        imageDataUrl: "data:image/jpeg;base64,AAAA",
        imageWidth: "800",
        imageHeight: "600",
      }),
    );

    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringContaining("product-1"),
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
    expect(mediaInsert).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: "product-1", width: 800, height: 600 }),
    );
    expect(state.status).toBe("success");
    expect(state.productId).toBe("product-1");
    expect(state.message).not.toContain("Photo upload failed");
  });

  it("still succeeds creating the product when imageDataUrl is present but the image upload fails", async () => {
    const { from, storage } = buildCreateProductSupabaseMock({ uploadError: true });
    mocks.createClient.mockResolvedValue({ from, storage });

    const state = await createProductAction(
      { status: "idle", values: {} },
      formData({
        ...CREATE_PRODUCT_REQUIRED_FIELDS,
        imageDataUrl: "data:image/jpeg;base64,AAAA",
        imageWidth: "800",
        imageHeight: "600",
      }),
    );

    expect(state.status).toBe("success");
    expect(state.productId).toBe("product-1");
    expect(state.message).toContain("Photo upload failed");
  });
});
