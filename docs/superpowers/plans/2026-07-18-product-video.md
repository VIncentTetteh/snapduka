# Product Video (Vlog Links) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sellers paste a link to an existing video (YouTube/TikTok/Vimeo/Instagram/other) onto a product; buyers see it as gallery slide 1 on the storefront product page.

**Architecture:** Four nullable columns added directly to `products` (`video_url`, `video_provider`, `video_id`, `video_thumbnail_url`) — no new table, no file storage. A pure URL-parsing utility extracts provider+ID and a deterministic thumbnail for YouTube; TikTok/Vimeo get a thumbnail via one server-side oEmbed call at save time; Instagram/other get no thumbnail. The storefront gallery renders the video as a thumbnail-with-play-button tile that swaps to a same-origin-safe iframe embed on tap, built from an internal template + validated ID — never from raw stored HTML.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Vitest + Testing Library, TypeScript.

## Global Constraints

- Free on every plan — no `planAllows`/`withinPlanLimit` check anywhere in this feature (per spec).
- One video per product — enforced by column shape (single set of nullable columns, not a repeatable relation).
- The iframe `src` is always built from an internal template string plus a regex-validated extracted ID — never the raw pasted URL or any stored third-party HTML interpolated directly.
- `src/proxy.ts`'s CSP `frame-src` gains exactly three domains (`www.youtube-nocookie.com`, `www.tiktok.com`, `player.vimeo.com`) — no wildcards.
- Migration filename: `supabase/migrations/202607180031_product_video.sql`. **Before running it**, check `ls supabase/migrations | tail -3` — if a migration numbered higher than `202607180030` already exists, bump this plan's filename to the next free number in the same pattern (`YYYYMMDDNN`) before proceeding.

## Design deviation from the approved spec (read this first)

The approved spec (`docs/superpowers/specs/2026-07-18-product-video-design.md`) modeled the video as a row in `product_media`. Researching the exact current schema for this plan surfaced real friction with that: `product_media.object_path` is `not null` **and** `unique`, and `width`/`height` are `not null integer` columns with a `check (width <= 1000 and height <= 1000)` — none of which fit a video row, and relaxing them risks the existing photo-upload path (`uploadProductImageAction`, `product_media_dimensions_check`).

This plan instead adds the four video columns directly to `products`. This achieves every requirement in the spec identically:
- **Moderation cascade** ("hiding a product hides its video too") — already true for free, because `video_url` etc. are just columns on the `products` row, and the existing `products_public_read` RLS policy (which already checks `moderation_status <> 'hidden'`) gates the whole row, video columns included. No RLS changes needed.
- **One video per product** — trivially true (one set of columns per row) instead of needing a partial unique index.
- **First slide in gallery** — the storefront page builds the video slide from the product's own columns and prepends it, rather than relying on a `product_media` sort order.
- **Zero risk to existing photo code** — `product_media`, `ProductMediaManager`, `ImageUploader`, and their RLS/constraints are untouched by this plan.

Nothing user-facing changes from the approved spec. If you want the `product_media`-row approach instead, stop here and say so before continuing.

---

### Task 1: Migration — video columns on `products`

**Files:**
- Create: `supabase/migrations/202607180031_product_video.sql`
- Create: `supabase/tests/database/012_product_video.test.sql`

**Interfaces:**
- Produces: `products.video_url text`, `products.video_provider text`, `products.video_id text`, `products.video_thumbnail_url text` — consumed by Task 3's server action and Task 6's storefront query.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607180031_product_video.sql
-- Product video: sellers link an existing YouTube/TikTok/Vimeo/Instagram
-- video per product; buyers see it as the first gallery slide. No file
-- storage — just a resolved link + thumbnail. Free on every plan.

alter table public.products
  add column video_url text,
  add column video_provider text
    check (video_provider in ('youtube', 'tiktok', 'vimeo', 'instagram', 'other')),
  add column video_id text,
  add column video_thumbnail_url text,
  add constraint products_video_url_provider_check
    check ((video_url is null) = (video_provider is null));

-- Sellers already have table-level UPDATE restricted to an explicit column
-- list (202607180030_product_moderation.sql) — add the new seller-writable
-- columns to that allowlist. This is additive; it does not touch the
-- existing grant.
grant update (video_url, video_provider, video_id, video_thumbnail_url)
  on public.products to authenticated;
```

- [ ] **Step 2: Apply it locally and confirm it runs clean**

Run: `pnpm db:reset`
Expected: the log shows `Applying migration 202607180031_product_video.sql...` with no error, ending in `Finished supabase db reset`.

- [ ] **Step 3: Write the pgTAP test**

```sql
-- supabase/tests/database/012_product_video.test.sql
begin;

set local search_path = extensions, public;

select plan(8);

select has_column('public', 'products', 'video_url', 'products has video_url');
select has_column('public', 'products', 'video_provider', 'products has video_provider');
select has_column('public', 'products', 'video_id', 'products has video_id');
select has_column('public', 'products', 'video_thumbnail_url', 'products has video_thumbnail_url');

-- Sellers can write the new video columns (this is the actual enforcement
-- point for "sellers can attach a video" — column-level grant, not RLS).
select is(
  has_column_privilege('authenticated', 'public.products', 'video_url', 'UPDATE'),
  true,
  'sellers can update video_url'
);
select is(
  has_column_privilege('authenticated', 'public.products', 'video_provider', 'UPDATE'),
  true,
  'sellers can update video_provider'
);

-- video_url and video_provider must be set together, never one without the
-- other — insert a seller/shop/product fixture and assert the constraint.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000006101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'video-fixture@example.com', '',
  now(), '{}'::jsonb, now(), now()
);
insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000006201',
  '00000000-0000-0000-0000-000000006101',
  'GH', 'active', true, 'Video Fixture Seller',
  'video-fixture@example.com', '+233241234573'
);
insert into public.shops (
  id, seller_account_id, slug, display_name, legal_name,
  country, currency, status, published_at
)
values (
  '00000000-0000-0000-0000-000000006301',
  '00000000-0000-0000-0000-000000006201',
  'video-fixture-shop', 'Video Fixture Shop', 'Video Fixture Shop Ltd',
  'GH', 'GHS', 'published', now()
);

select throws_ok(
  $$
    insert into public.products (
      shop_id, seller_account_id, name, slug, description,
      currency, price_minor, status, inventory_policy, stock_quantity,
      video_url
    )
    values (
      '00000000-0000-0000-0000-000000006301',
      '00000000-0000-0000-0000-000000006201',
      'Video only, no provider', 'video-only-no-provider', '', 'GHS', 1000,
      'draft', 'track', 1,
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
  $$,
  '23514',
  null,
  'video_url without video_provider is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `supabase/tests/database/012_product_video.test.sql .. ok` in the output, `Result: FAIL` only if the pre-existing unrelated `001_core.test.sql` plan-versioning failure is still there (known, not caused by this work) — no failures attributable to `012_product_video.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607180031_product_video.sql supabase/tests/database/012_product_video.test.sql
git commit -m "feat: add product video columns to products table"
```

---

### Task 2: `src/lib/catalog/video.ts` — URL parsing and embed-URL building

**Files:**
- Create: `src/lib/catalog/video.ts`
- Create: `src/lib/catalog/video.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, plus `fetch` for the oEmbed helper).
- Produces:
  - `type VideoProvider = "youtube" | "tiktok" | "vimeo" | "instagram" | "other"`
  - `type ParsedVideo = { provider: VideoProvider; videoId: string | null; thumbnailUrl: string | null }`
  - `parseVideoUrl(rawUrl: string): ParsedVideo`
  - `fetchOembedThumbnail(provider: VideoProvider, videoUrl: string): Promise<string | null>`
  - `buildEmbedUrl(provider: VideoProvider, videoId: string): string | null`
  
  Consumed by Task 3 (`parseVideoUrl`, `fetchOembedThumbnail`) and Task 5 (`buildEmbedUrl`, `VideoProvider` type).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/catalog/video.test.ts
import { describe, expect, it } from "vitest";

import { buildEmbedUrl, parseVideoUrl } from "./video";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/catalog/video.test.ts`
Expected: FAIL — `Cannot find module './video'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/catalog/video.ts

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/catalog/video.test.ts`
Expected: PASS — all 14 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/video.ts src/lib/catalog/video.test.ts
git commit -m "feat: add video URL parsing and embed-URL builder"
```

---

### Task 3: `setProductVideoAction` server action

**Files:**
- Modify: `src/app/(seller)/dashboard/products/actions.ts` (append; add one import line)
- Create: `src/app/(seller)/dashboard/products/actions.test.ts`

**Interfaces:**
- Consumes: `parseVideoUrl`, `fetchOembedThumbnail` from `@/lib/catalog/video` (Task 2); existing `value()` helper, `resolveServerActor`, `hasPermission`, `createClient` already imported in this file.
- Produces: `setProductVideoAction(formData: FormData): Promise<void>` — consumed by Task 4's form.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(seller)/dashboard/products/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  parseVideoUrl: vi.fn(),
  fetchOembedThumbnail: vi.fn(),
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
  });

  it("does nothing for a non-seller actor", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/app/\(seller\)/dashboard/products/actions.test.ts`
Expected: FAIL — `setProductVideoAction is not exported` or similar.

- [ ] **Step 3: Add the import and the action**

Add this import to the top of `src/app/(seller)/dashboard/products/actions.ts`, alongside the existing imports:

```ts
import { fetchOembedThumbnail, parseVideoUrl } from "@/lib/catalog/video";
```

Append this function to the end of `src/app/(seller)/dashboard/products/actions.ts`:

```ts
export async function setProductVideoAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage") || !productId) return;

  const videoUrl = value(formData, "videoUrl").trim();
  const supabase = await createClient();

  if (!videoUrl) {
    await supabase
      .from("products")
      .update({ video_url: null, video_provider: null, video_id: null, video_thumbnail_url: null })
      .eq("id", productId)
      .eq("seller_account_id", actor.sellerAccountId);
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath("/dashboard/products");
    return;
  }

  const parsed = parseVideoUrl(videoUrl);
  const thumbnailUrl =
    parsed.thumbnailUrl ??
    (parsed.videoId ? await fetchOembedThumbnail(parsed.provider, videoUrl) : null);

  await supabase
    .from("products")
    .update({
      video_url: videoUrl,
      video_provider: parsed.provider,
      video_id: parsed.videoId,
      video_thumbnail_url: thumbnailUrl,
    })
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId);

  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/\(seller\)/dashboard/products/actions.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(seller\)/dashboard/products/actions.ts src/app/\(seller\)/dashboard/products/actions.test.ts
git commit -m "feat: add setProductVideoAction server action"
```

---

### Task 4: Seller edit-page UI

**Files:**
- Modify: `src/app/(seller)/dashboard/products/[productId]/page.tsx`

**Interfaces:**
- Consumes: `setProductVideoAction` from `./actions` (Task 3).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add `setProductVideoAction` to the import and `video_url` to the query**

In `src/app/(seller)/dashboard/products/[productId]/page.tsx`, change the existing import line:

```tsx
import { addVariantAction, archiveVariantAction, updateProductAction, updateVariantAction } from "@/app/(seller)/dashboard/products/actions";
```

to:

```tsx
import { addVariantAction, archiveVariantAction, setProductVideoAction, updateProductAction, updateVariantAction } from "@/app/(seller)/dashboard/products/actions";
```

Change the existing products `.select(...)` string:

```tsx
const { data: product } = await supabase.from("products").select("id,name,description,currency,price_minor,sku,status,inventory_policy,stock_quantity,reserved_quantity,product_media(id,object_path,position),product_variants(id,name,sku,price_minor,inventory_policy,stock_quantity,reserved_quantity,active)").eq("id", productId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
```

to:

```tsx
const { data: product } = await supabase.from("products").select("id,name,description,currency,price_minor,sku,status,inventory_policy,stock_quantity,reserved_quantity,video_url,product_media(id,object_path,position),product_variants(id,name,sku,price_minor,inventory_policy,stock_quantity,reserved_quantity,active)").eq("id", productId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
```

- [ ] **Step 2: Add the "Product video" section**

Insert this new `<section>` immediately after the closing `</section>` of the existing "Photos" block (which ends with `<ProductMediaManager media={product.product_media ?? []} productId={product.id} />\n      </section>`) and before the "Variants" `<section>`:

```tsx
      <section className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Product video</h2>
        <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>
          Paste a link to a video you&apos;ve already posted — YouTube, TikTok, Instagram Reels, or
          anywhere else. It shows as the first slide in your product gallery.
        </p>
        <form action={setProductVideoAction} className="grid gap-2">
          <input name="productId" type="hidden" value={product.id} />
          <input
            className="field-input"
            defaultValue={product.video_url ?? ""}
            name="videoUrl"
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
          />
          <button className="btn-primary w-full" type="submit">Save video</button>
        </form>
        {product.video_url ? (
          <form action={setProductVideoAction}>
            <input name="productId" type="hidden" value={product.id} />
            <input name="videoUrl" type="hidden" value="" />
            <button className="btn-secondary w-full" type="submit">Remove video</button>
          </form>
        ) : null}
      </section>
```

- [ ] **Step 3: Manually verify in the browser**

Run: `pnpm dev:local`, log in as a seller, open `/dashboard/products/<some-product-id>`.
Expected: a "Product video" card appears below Photos and above Variants, with a URL input pre-filled if a video is already set, a "Save video" button, and a "Remove video" button only when a video is currently set.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(seller\)/dashboard/products/\[productId\]/page.tsx
git commit -m "feat: add product video field to seller edit page"
```

---

### Task 5: `ProductGallery` component — video slide support

**Files:**
- Modify: `src/components/storefront/product-gallery.tsx`
- Create: `src/components/storefront/product-gallery.test.tsx`

**Interfaces:**
- Consumes: `buildEmbedUrl`, `type VideoProvider` from `@/lib/catalog/video` (Task 2).
- Produces: `type VideoSlide = { provider: VideoProvider; videoId: string | null; videoUrl: string; thumbnailUrl: string | null }`; `ProductGallery` gains an optional `video?: VideoSlide | null` prop. Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/storefront/product-gallery.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ProductGallery, type VideoSlide } from "./product-gallery";

const YOUTUBE_VIDEO: VideoSlide = {
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

const OTHER_VIDEO: VideoSlide = {
  provider: "other",
  videoId: null,
  videoUrl: "https://example.com/watch",
  thumbnailUrl: null,
};

describe("ProductGallery", () => {
  it("renders the fallback gradient block when there is no media at all", () => {
    render(<ProductGallery images={[]} productName="Blue Sneakers" fallbackGradient="red" />);
    expect(screen.getByRole("img", { name: /photo coming soon/i })).toBeInTheDocument();
  });

  it("renders only photos when there is no video", () => {
    render(
      <ProductGallery
        images={["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]}
        productName="Blue Sneakers"
        fallbackGradient="red"
      />,
    );
    expect(screen.getByAltText("Blue Sneakers")).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("shows the video as the first slide with a play button, before any photos", () => {
    render(
      <ProductGallery
        images={["https://cdn.example.com/a.jpg"]}
        video={YOUTUBE_VIDEO}
        productName="Blue Sneakers"
        fallbackGradient="red"
      />,
    );
    expect(screen.getByRole("button", { name: /play video for blue sneakers/i })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-label", "Video");
  });

  it("swaps the video thumbnail for a same-origin-safe embed iframe on tap", async () => {
    const user = userEvent.setup();
    render(
      <ProductGallery images={[]} video={YOUTUBE_VIDEO} productName="Blue Sneakers" fallbackGradient="red" />,
    );

    await user.click(screen.getByRole("button", { name: /play video for blue sneakers/i }));

    const iframe = screen.getByTitle("Blue Sneakers video");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
  });

  it("opens the original link in a new tab for providers with no safe embed, instead of rendering an iframe", async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    render(
      <ProductGallery images={[]} video={OTHER_VIDEO} productName="Blue Sneakers" fallbackGradient="red" />,
    );
    await user.click(screen.getByRole("button", { name: /play video for blue sneakers/i }));

    expect(openSpy).toHaveBeenCalledWith("https://example.com/watch", "_blank", "noopener,noreferrer");
    expect(screen.queryByTitle("Blue Sneakers video")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
```

Add `import { vi } from "vitest";` to the top import line (change `import { describe, expect, it } from "vitest";` to `import { describe, expect, it, vi } from "vitest";`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/storefront/product-gallery.test.tsx`
Expected: FAIL — `video` prop and `VideoSlide` export don't exist yet.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `src/components/storefront/product-gallery.tsx` with:

```tsx
"use client";

import { useState } from "react";

import { buildEmbedUrl, type VideoProvider } from "@/lib/catalog/video";

export type VideoSlide = {
  provider: VideoProvider;
  videoId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
};

/**
 * Product gallery: an optional video as the first slide, then photos.
 * Falls back to a warm gradient block when the product has no media at all.
 */
export function ProductGallery({
  images,
  video,
  productName,
  fallbackGradient,
}: {
  images: string[];
  video?: VideoSlide | null;
  productName: string;
  fallbackGradient: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const hasVideo = Boolean(video);
  const totalSlides = images.length + (hasVideo ? 1 : 0);

  if (totalSlides === 0) {
    return (
      <span
        role="img"
        aria-label={`${productName} — photo coming soon`}
        className="block aspect-square rounded-[18px]"
        style={{ background: fallbackGradient }}
      />
    );
  }

  const isVideoSlide = hasVideo && activeIndex === 0;
  const activeImageUrl = isVideoSlide
    ? null
    : images[Math.min(activeIndex - (hasVideo ? 1 : 0), images.length - 1)];
  const embedUrl = video && video.videoId ? buildEmbedUrl(video.provider, video.videoId) : null;

  function selectSlide(index: number) {
    setPlaying(false);
    setActiveIndex(index);
  }

  function handleVideoTap() {
    if (!video) return;
    if (embedUrl) {
      setPlaying(true);
      return;
    }
    window.open(video.videoUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      {isVideoSlide && video ? (
        playing && embedUrl ? (
          <iframe
            src={embedUrl}
            title={`${productName} video`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="block aspect-square w-full rounded-[18px] border border-line bg-black"
          />
        ) : (
          <button
            type="button"
            onClick={handleVideoTap}
            aria-label={`Play video for ${productName}`}
            className="relative block aspect-square w-full cursor-pointer overflow-hidden rounded-[18px] border border-line bg-ink p-0"
          >
            {video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={video.thumbnailUrl} className="h-full w-full object-cover opacity-80" />
            ) : null}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-ink">
                <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6 4.5v11l9-5.5-9-5.5Z" />
                </svg>
              </span>
            </span>
          </button>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={productName}
          src={activeImageUrl ?? undefined}
          className="block aspect-square w-full rounded-[18px] border border-line bg-white object-cover"
        />
      )}
      {totalSlides > 1 ? (
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product media">
          {hasVideo && video ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeIndex === 0}
              aria-label="Video"
              onClick={() => selectSlide(0)}
              className={`relative h-14 w-14 flex-none cursor-pointer overflow-hidden rounded-[10px] bg-ink p-0 ${
                activeIndex === 0 ? "border-2 border-accent" : "border border-line"
              }`}
            >
              {video.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={video.thumbnailUrl} className="h-full w-full object-cover opacity-70" />
              ) : null}
              <span className="absolute inset-0 grid place-items-center text-white">▶</span>
            </button>
          ) : null}
          {images.map((url, index) => {
            const slideIndex = index + (hasVideo ? 1 : 0);
            return (
              <button
                key={url}
                type="button"
                role="tab"
                aria-selected={slideIndex === activeIndex}
                aria-label={`Photo ${index + 1} of ${images.length}`}
                onClick={() => selectSlide(slideIndex)}
                className={`h-14 w-14 flex-none cursor-pointer overflow-hidden rounded-[10px] bg-white p-0 ${
                  slideIndex === activeIndex ? "border-2 border-accent" : "border border-line"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={url} className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/storefront/product-gallery.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/storefront/product-gallery.tsx src/components/storefront/product-gallery.test.tsx
git commit -m "feat: add video slide support to ProductGallery"
```

---

### Task 6: Storefront wiring — query + product page

**Files:**
- Modify: `src/lib/storefront/queries.ts`
- Modify: `src/app/(storefront)/[slug]/products/[productId]/page.tsx`

**Interfaces:**
- Consumes: `ProductGallery`, `type VideoSlide` from `@/components/storefront/product-gallery` (Task 5); `type VideoProvider` from `@/lib/catalog/video` (Task 2).
- Produces: nothing consumed by later tasks — this is the feature's final visible wiring.

- [ ] **Step 1: Add the video columns to `getPublicProduct`**

In `src/lib/storefront/queries.ts`, change the `getPublicProduct` select string from:

```ts
    .select(
      "id, name, slug, description, currency, price_minor, inventory_policy, stock_quantity, reserved_quantity, product_media(object_path, alt_text, position), product_variants(id, name, sku, price_minor, image_path, inventory_policy, stock_quantity, reserved_quantity)",
    )
```

to:

```ts
    .select(
      "id, name, slug, description, currency, price_minor, inventory_policy, stock_quantity, reserved_quantity, video_url, video_provider, video_id, video_thumbnail_url, product_media(object_path, alt_text, position), product_variants(id, name, sku, price_minor, image_path, inventory_policy, stock_quantity, reserved_quantity)",
    )
```

- [ ] **Step 2: Build the video slide and pass it to `ProductGallery`**

In `src/app/(storefront)/[slug]/products/[productId]/page.tsx`, change the import line:

```tsx
import { ProductGallery } from "@/components/storefront/product-gallery";
```

to:

```tsx
import { ProductGallery, type VideoSlide } from "@/components/storefront/product-gallery";
import type { VideoProvider } from "@/lib/catalog/video";
```

Immediately after the existing `imageUrls` block:

```tsx
  const imageUrls = (product.product_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((media) => publicMediaUrl(media.object_path))
    .filter((url): url is string => Boolean(url));
```

add:

```tsx
  const videoSlide: VideoSlide | null =
    product.video_url && product.video_provider
      ? {
          provider: product.video_provider as VideoProvider,
          videoId: product.video_id,
          videoUrl: product.video_url,
          thumbnailUrl: product.video_thumbnail_url,
        }
      : null;
```

Change the `<ProductGallery ... />` call from:

```tsx
            <ProductGallery
              fallbackGradient={heroGradient}
              images={imageUrls}
              productName={product.name}
            />
```

to:

```tsx
            <ProductGallery
              fallbackGradient={heroGradient}
              images={imageUrls}
              productName={product.name}
              video={videoSlide}
            />
```

- [ ] **Step 3: Manually verify in the browser**

Run: `pnpm dev:local`. As a seller, save a real YouTube link on a product via the Task 4 UI. Then open that product's public storefront page (`/{shop-slug}/products/{product-id}`).
Expected: the video's YouTube thumbnail renders as gallery slide 1 with a play-button overlay; tapping it swaps to a playable `youtube-nocookie.com` iframe; the thumbnail strip shows the video tile first, then photos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/storefront/queries.ts src/app/\(storefront\)/\[slug\]/products/\[productId\]/page.tsx
git commit -m "feat: render product video as the first storefront gallery slide"
```

---

### Task 7: CSP — allow the three embed domains

**Files:**
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the CSP `frame-src` directive**

In `src/proxy.ts`, inside the `contentSecurityPolicy` function, change:

```ts
    "frame-src https://js.paystack.co https://checkout.paystack.com",
```

to:

```ts
    "frame-src https://js.paystack.co https://checkout.paystack.com https://www.youtube-nocookie.com https://www.tiktok.com https://player.vimeo.com",
```

- [ ] **Step 2: Manually verify the embed isn't blocked**

Run: `pnpm dev:local`, open a product page with a saved YouTube video (from Task 6's verification), tap play, open the browser devtools console.
Expected: no `Refused to frame ... because it violates the following Content Security Policy directive` error; the iframe loads and plays.

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat: allow video embed domains in CSP frame-src"
```

---

### Task 8: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–7.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass (the new `video.test.ts`, `actions.test.ts`, and `product-gallery.test.tsx` files included).

- [ ] **Step 2: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `012_product_video.test.sql .. ok`; no new failures beyond the pre-existing, unrelated `001_core.test.sql` plan-versioning issue.

- [ ] **Step 3: Manual end-to-end pass on local dev**

Run: `pnpm dev:local`. As a seller:
1. Paste a real YouTube URL on a product, save. Confirm the edit page shows "Remove video."
2. Open that product's public storefront page. Confirm the video is gallery slide 1 with a thumbnail and play button; tap it and confirm it plays inline.
3. Go back to the edit page, paste a TikTok URL instead, save. Confirm it replaces the YouTube video (only one video, per the one-video-per-product design) and — on the storefront — shows a TikTok thumbnail if the oEmbed call succeeded, or a plain black tile with just a play button if it didn't (both are correct per the "best-effort" design).
4. Paste a garbage, non-video URL (e.g. `https://example.com`), save. Confirm the storefront shows a play button with no thumbnail, and tapping it opens `https://example.com` in a new tab instead of showing a broken embed.
5. Click "Remove video." Confirm the storefront gallery goes back to photos-only, with the first photo as slide 1.
6. As an operator, hide the product via the admin moderation flow (`/admin/products/[productId]`, from earlier session work). Confirm the storefront product page 404s/is inaccessible — video included, since it's just a column on the now-hidden `products` row.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
