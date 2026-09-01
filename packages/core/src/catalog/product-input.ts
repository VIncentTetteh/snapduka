import type { CurrencyCode } from "../countries/types";

/**
 * Building the row a product save sends to Postgres.
 *
 * Two constraints make this worth centralising rather than assembling inline at
 * each call site:
 *
 * 1. `products` has a **column-level** UPDATE grant for `authenticated`
 *    (202607180030:21-25, extended by 202607180031 and 202607200035). Anything
 *    outside that allowlist — `shop_id`, `seller_account_id`, `updated_at`,
 *    the moderation columns — fails the whole statement with a permission
 *    error. The mobile app sent `shop_id` on every edit, so no product could be
 *    saved from the phone.
 * 2. Three CHECK constraints have to hold together:
 *    - `products_stock_check`: stock_quantity is non-null iff policy is 'track'
 *    - `products_published_check`: published_at is non-null when status='active'
 *    - compare_at_price_minor, if set, must be strictly greater than price_minor
 */

export type ProductStatus = "draft" | "active" | "archived";
export type InventoryPolicy = "track" | "continue_selling" | "deny_when_out_of_stock";

export type VideoProvider = "youtube" | "tiktok" | "vimeo" | "instagram" | "other";

export type ProductFields = {
  name: string;
  slug: string;
  description: string;
  currency: CurrencyCode;
  priceMinor: number;
  status: ProductStatus;
  inventoryPolicy: InventoryPolicy;
  stockQuantity: number | null;
  sku?: string | null;
  compareAtPriceMinor?: number | null;
  costMinor?: number | null;
  videoUrl?: string | null;
};

export type ProductInvalid =
  | "compare_at_not_greater"
  | "stock_required_when_tracking"
  | "negative_cost";

/** Columns `authenticated` may UPDATE on products, in migration order. */
export const PRODUCT_UPDATABLE_COLUMNS = [
  "name",
  "slug",
  "description",
  "currency",
  "price_minor",
  "compare_at_price_minor",
  "sku",
  "status",
  "inventory_policy",
  "stock_quantity",
  "reserved_quantity",
  "published_at",
  "video_url",
  "video_provider",
  "video_id",
  "video_thumbnail_url",
  "cost_minor",
] as const;

export type VideoColumns = {
  video_url: string | null;
  video_provider: VideoProvider | null;
  video_id: string | null;
  video_thumbnail_url: string | null;
};

/**
 * Derive the four video columns from a pasted link.
 *
 * The table has a CHECK that `(video_url is null) = (video_provider is null)`,
 * so a URL without a provider — or the reverse — is rejected outright. They are
 * therefore always produced together, never independently.
 */
export function buildVideoColumns(rawUrl: string | null | undefined): VideoColumns {
  const url = rawUrl?.trim();
  if (!url) {
    return { video_url: null, video_provider: null, video_id: null, video_thumbnail_url: null };
  }

  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
    return { video_url: url, video_provider: "youtube", video_id: match?.[1] ?? null, video_thumbnail_url: null };
  }
  if (lower.includes("tiktok.com")) {
    return { video_url: url, video_provider: "tiktok", video_id: null, video_thumbnail_url: null };
  }
  if (lower.includes("vimeo.com")) {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return { video_url: url, video_provider: "vimeo", video_id: match?.[1] ?? null, video_thumbnail_url: null };
  }
  if (lower.includes("instagram.com")) {
    return { video_url: url, video_provider: "instagram", video_id: null, video_thumbnail_url: null };
  }
  return { video_url: url, video_provider: "other", video_id: null, video_thumbnail_url: null };
}

/** Constraint violations the database would reject, checked before the round trip. */
export function validateProductFields(fields: ProductFields): ProductInvalid | null {
  if (fields.inventoryPolicy === "track" && fields.stockQuantity === null) {
    return "stock_required_when_tracking";
  }
  if (
    fields.compareAtPriceMinor != null &&
    fields.compareAtPriceMinor <= fields.priceMinor
  ) {
    return "compare_at_not_greater";
  }
  if (fields.costMinor != null && fields.costMinor < 0) return "negative_cost";
  return null;
}

function shared(fields: ProductFields) {
  return {
    name: fields.name.trim(),
    slug: fields.slug,
    description: fields.description.trim(),
    currency: fields.currency,
    price_minor: fields.priceMinor,
    compare_at_price_minor: fields.compareAtPriceMinor ?? null,
    sku: fields.sku?.trim() || null,
    status: fields.status,
    inventory_policy: fields.inventoryPolicy,
    // Non-null iff we are tracking stock, which is exactly products_stock_check.
    stock_quantity: fields.inventoryPolicy === "track" ? fields.stockQuantity : null,
    cost_minor: fields.costMinor ?? null,
    ...buildVideoColumns(fields.videoUrl),
  };
}

/**
 * A new product row. INSERT is table-level, so shop_id and seller_account_id —
 * which UPDATE may not touch — are set here and only here.
 */
export function buildProductInsert(
  fields: ProductFields,
  scope: { shopId: string; sellerAccountId: string },
  now: string,
) {
  return {
    ...shared(fields),
    shop_id: scope.shopId,
    seller_account_id: scope.sellerAccountId,
    published_at: fields.status === "active" ? now : null,
  };
}

/**
 * An update payload containing only allowlisted columns.
 *
 * `shop_id` is deliberately absent: a product never moves between shops, and
 * including it is a permission error rather than a no-op.
 */
export function buildProductUpdate(fields: ProductFields, now: string) {
  return {
    ...shared(fields),
    // products_published_check requires published_at when active, and leaving a
    // stale timestamp on an unpublished product misreports when it went live.
    published_at: fields.status === "active" ? now : null,
  };
}
