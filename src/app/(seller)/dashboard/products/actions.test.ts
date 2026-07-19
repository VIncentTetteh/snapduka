import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  parseVideoUrl: vi.fn(),
  fetchOembedThumbnail: vi.fn(),
  isSafeHttpUrl: vi.fn(),
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

import { setProductVideoAction } from "./actions";

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
