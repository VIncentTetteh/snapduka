export type MediaBucket = "product-images" | "shop-logos";

/**
 * Resolves a stored object path to a browser-loadable URL.
 * Absolute URLs (externally hosted media) pass through untouched; storage
 * paths resolve against the public bucket endpoint.
 */
export function publicMediaUrl(
  objectPath: string | null | undefined,
  bucket: MediaBucket = "product-images",
): string | null {
  if (!objectPath) return null;
  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/**
 * Supabase's untyped client always infers a `shop_branding(...)` embed as
 * an array, but `shop_branding.shop_id` is a primary key — a genuine
 * one-to-one relationship — so PostgREST actually returns a single object
 * (or null) at runtime. Normalizes either shape before reading a field.
 */
export function normalizeToOne<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}

type MediaRecord = { object_path: string; position: number };

/** Main image = lowest position; returns its public URL or null. */
export function mainImageUrl(media: MediaRecord[] | null | undefined): string | null {
  if (!media?.length) return null;
  const sorted = media.slice().sort((a, b) => a.position - b.position);
  return publicMediaUrl(sorted[0].object_path);
}
