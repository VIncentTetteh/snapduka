export type VideoProvider = "youtube" | "tiktok" | "vimeo" | "instagram" | "other";

export type ParsedVideo = {
  provider: VideoProvider;
  videoId: string | null;
  thumbnailUrl: string | null;
};

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    const id = url.pathname.slice(1);
    return YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }
  if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
    }
    const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/);
    if (shortsMatch) return shortsMatch[1];
  }
  return null;
}

function extractTikTokId(url: URL): string | null {
  if (url.hostname !== "tiktok.com" && !url.hostname.endsWith(".tiktok.com")) return null;
  const match = url.pathname.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

function extractVimeoId(url: URL): string | null {
  if (url.hostname !== "vimeo.com" && !url.hostname.endsWith(".vimeo.com")) return null;
  const match = url.pathname.match(/^\/(\d+)/);
  return match ? match[1] : null;
}

function extractInstagramId(url: URL): string | null {
  if (url.hostname !== "instagram.com" && !url.hostname.endsWith(".instagram.com")) return null;
  const match = url.pathname.match(/^\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Parses a pasted video URL into a provider + ID, with a deterministic
 * thumbnail where one is available without a network call (YouTube only —
 * TikTok/Vimeo need `fetchOembedThumbnail`; Instagram/other never get one).
 * Never throws — an unparseable or non-http(s) URL becomes `provider: "other"`.
 */
export function parseVideoUrl(rawUrl: string): ParsedVideo {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { provider: "other", videoId: null, thumbnailUrl: null };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { provider: "other", videoId: null, thumbnailUrl: null };
  }

  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      provider: "youtube",
      videoId: youtubeId,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  const tiktokId = extractTikTokId(url);
  if (tiktokId) return { provider: "tiktok", videoId: tiktokId, thumbnailUrl: null };

  const vimeoId = extractVimeoId(url);
  if (vimeoId) return { provider: "vimeo", videoId: vimeoId, thumbnailUrl: null };

  const instagramId = extractInstagramId(url);
  if (instagramId) return { provider: "instagram", videoId: instagramId, thumbnailUrl: null };

  return { provider: "other", videoId: null, thumbnailUrl: null };
}

/**
 * Fetches a thumbnail via a provider's public oEmbed endpoint. Returns null
 * on any failure, non-OK response, or timeout — callers must treat that as
 * "no thumbnail available," never as an error that blocks saving the video.
 */
export async function fetchOembedThumbnail(
  provider: VideoProvider,
  videoUrl: string,
): Promise<string | null> {
  const endpoint =
    provider === "tiktok"
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`
      : provider === "vimeo"
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`
        : null;
  if (!endpoint) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { thumbnail_url?: unknown };
    return typeof data.thumbnail_url === "string" ? data.thumbnail_url : null;
  } catch {
    return null;
  }
}

/**
 * Builds a safe embed URL from a template string plus a validated provider +
 * video ID — never from raw pasted URLs or stored third-party HTML. Returns
 * null for providers with no safe inline embed (Instagram, other).
 */
export function buildEmbedUrl(provider: VideoProvider, videoId: string): string | null {
  switch (provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`;
    case "tiktok":
      return `https://www.tiktok.com/embed/v2/${videoId}`;
    case "vimeo":
      return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
    default:
      return null;
  }
}
