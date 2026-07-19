import { describe, expect, it } from "vitest";

import { buildEmbedUrl, isSafeHttpUrl, parseVideoUrl } from "./video";

describe("isSafeHttpUrl", () => {
  it("accepts https and http URLs", () => {
    expect(isSafeHttpUrl("https://example.com/video.mp4")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/video.mp4")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(document.cookie)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects unparseable input instead of throwing", () => {
    expect(isSafeHttpUrl("not a url at all")).toBe(false);
  });
});

describe("parseVideoUrl", () => {
  it("extracts a YouTube watch URL and builds a deterministic thumbnail", () => {
    const result = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
  });

  it("extracts a youtu.be short link", () => {
    const result = parseVideoUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(result.provider).toBe("youtube");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("extracts a YouTube Shorts URL", () => {
    const result = parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(result.provider).toBe("youtube");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("extracts a TikTok video URL with no thumbnail (needs a network call)", () => {
    const result = parseVideoUrl("https://www.tiktok.com/@someuser/video/7123456789012345678");
    expect(result).toEqual({
      provider: "tiktok",
      videoId: "7123456789012345678",
      thumbnailUrl: null,
    });
  });

  it("extracts a Vimeo URL", () => {
    const result = parseVideoUrl("https://vimeo.com/76979871");
    expect(result).toEqual({ provider: "vimeo", videoId: "76979871", thumbnailUrl: null });
  });

  it("extracts an Instagram reel URL", () => {
    const result = parseVideoUrl("https://www.instagram.com/reel/Cabc123XYZ/");
    expect(result).toEqual({ provider: "instagram", videoId: "Cabc123XYZ", thumbnailUrl: null });
  });

  it("falls back to 'other' for an unrecognized URL", () => {
    const result = parseVideoUrl("https://example.com/some-video");
    expect(result).toEqual({ provider: "other", videoId: null, thumbnailUrl: null });
  });

  it("falls back to 'other' for garbage input instead of throwing", () => {
    const result = parseVideoUrl("not a url at all");
    expect(result).toEqual({ provider: "other", videoId: null, thumbnailUrl: null });
  });

  it("rejects non-http(s) protocols", () => {
    const result = parseVideoUrl("javascript:alert(1)");
    expect(result).toEqual({ provider: "other", videoId: null, thumbnailUrl: null });
  });
});

describe("buildEmbedUrl", () => {
  it("builds a privacy-enhanced YouTube embed URL", () => {
    expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
  });

  it("builds a TikTok embed URL", () => {
    expect(buildEmbedUrl("tiktok", "7123456789012345678")).toBe(
      "https://www.tiktok.com/embed/v2/7123456789012345678",
    );
  });

  it("builds a Vimeo embed URL", () => {
    expect(buildEmbedUrl("vimeo", "76979871")).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1",
    );
  });

  it("returns null for providers with no safe inline embed", () => {
    expect(buildEmbedUrl("instagram", "Cabc123XYZ")).toBeNull();
    expect(buildEmbedUrl("other", "anything")).toBeNull();
  });
});
