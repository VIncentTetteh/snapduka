# Product Video (Vlog Links) Design

## Scope

Let sellers attach one existing video (YouTube, TikTok, Instagram Reel,
Vimeo, or any other link) to a product, so buyers see it as the first slide
in the product's photo gallery. No file upload, storage, or transcoding —
sellers link to a video they've already posted. Free on every plan.

## Architecture

The video is a row in the existing `product_media` table rather than a new
table, so it inherits gallery ordering, storefront visibility RLS, and
operator moderation for free — hiding a product hides its video along with
its photos, with no separate moderation path needed.

`product_media` gains:
- `media_type text not null default 'image' check (media_type in ('image','video'))`
- `object_path`, `width`, `height` become nullable — required only when
  `media_type = 'image'`; the existing 1000px dimension cap is scoped to
  image rows only.
- `video_url text`, `video_provider text` (`youtube`/`tiktok`/`vimeo`/`instagram`/`other`),
  `video_id text` (extracted ID), `thumbnail_url text` (external image URL;
  always null for `instagram`/`other`; may also be null for `tiktok`/`vimeo`
  if their oEmbed call fails at save time — see Failure Handling)
- A check constraint enforcing exactly one shape per row: image rows carry
  `object_path` and no video columns; video rows carry `video_url`/`video_provider`
  and no `object_path`.
- A partial unique index `(product_id) where media_type = 'video'` — one
  video per product, enforced at the database level.

Gallery queries order `by (media_type = 'video') desc, position asc` so the
video always sorts first without ever renumbering image `position` values.

A new utility `src/lib/catalog/video.ts` recognizes URL shapes per provider
and extracts `video_id`:
- YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`) — ID
  extraction is regex-only, no network call. Thumbnail is deterministic:
  `https://i.ytimg.com/vi/{id}/hqdefault.jpg`.
- TikTok (`tiktok.com/@user/video/{id}`) and Vimeo (`vimeo.com/{id}`) — ID
  extraction by regex; thumbnail requires one server-side oEmbed HTTP call
  per provider (both are public, no auth required).
- Instagram (`instagram.com/reel/{id}`, `/p/{id}`) — ID extracted, no
  thumbnail (Meta's oEmbed requires an authenticated app token, out of
  scope).
- Anything else — `provider: 'other'`, raw URL stored, no ID/thumbnail.

## Behavior

**Seller side:** a "Product video" field on the existing product edit page
(same Panel layout as the rest of the page) — a URL input plus a "Remove
video" action once one is attached. A new server action
`setProductVideoAction` in the seller's existing
`src/app/(seller)/dashboard/products/actions.ts` parses the URL, resolves a
thumbnail where possible, deletes any prior video row for that product, and
inserts the new one. Pasting an unrecognized URL never errors — it saves as
`provider: 'other'` with no thumbnail. Clearing the field deletes the video
row. No plan/entitlement check — available on every plan, like product
photos.

**Storefront side:** the existing buyer-facing gallery component branches on
`media_type`. A video slide shows its `thumbnail_url` (YouTube/TikTok/Vimeo)
or a generic provider-branded placeholder (Instagram/other) with a
play-button overlay, indistinguishable in layout from a photo slide. On tap,
the thumbnail is replaced in place with the real embed, loaded lazily so no
third-party embed script/iframe loads until the buyer actually wants to
watch:
- YouTube → `youtube-nocookie.com` privacy-enhanced iframe
- TikTok → `tiktok.com/embed/v2/{id}` iframe
- Vimeo → `player.vimeo.com` iframe
- Instagram / other → opens the original link in a new tab; no inline embed

`src/proxy.ts`'s CSP `frame-src` gains exactly three new domains
(`youtube-nocookie.com`, `tiktok.com`, `player.vimeo.com`) — an explicit
allowlist addition, no wildcards.

## Failure Handling

The iframe `src` is always built from an internal template string plus a
strictly-validated extracted ID (e.g. YouTube IDs must match
`^[A-Za-z0-9_-]{11}$`) — never the raw pasted URL interpolated directly, so a
crafted "ID" can't break out of the embed URL. Unrecognized providers never
get an iframe, only an outbound link, so no arbitrary domain is ever framed.
TikTok/Vimeo oEmbed calls run server-side with a timeout; on failure or
timeout the video still saves, just without a thumbnail, rather than
blocking the product save.

## Acceptance

Unit tests cover the URL-parsing utility (real-world URL shapes per
platform — including `youtu.be`, `/shorts/`, mobile URLs with query params —
plus garbage input falling back to `other` cleanly) and
`setProductVideoAction` (insert/replace/delete logic, confirms no plan gate
is applied). Manual verification: paste a real YouTube link and confirm
thumbnail + gallery-slide-one placement + tap-to-play; same for TikTok;
paste a non-video URL and confirm the graceful `other` fallback; remove the
video and confirm photos reflow to slide one.
