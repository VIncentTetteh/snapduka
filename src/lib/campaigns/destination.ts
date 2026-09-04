import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a tracked link is allowed to point.
 *
 * `campaign_links.destination_path` was accepted straight off a form and
 * inserted unchecked, so a seller could mint a link aimed at any path on the
 * site — including another seller's shop or product. Production had four:
 * sika-threads links pointing at PurePlatter's product, which 404 for the buyer
 * because the storefront filters a product by the shop in the path.
 *
 * Money was never at risk — `create_guest_order_growth` looks the link up by
 * `shop_id` as well as token, so a cross-shop link cannot attribute an order.
 * But `/l/` still records the click against whoever minted it, so the link's
 * owner sees traffic for a page that failed to load, and the buyer sees
 * nothing.
 *
 * `/l/[token]` already refuses to leave the origin. This is the other half:
 * a link may only point somewhere its own seller owns.
 */

const PRODUCT_PATH = /^\/([^/]+)\/products\/([0-9a-fA-F-]{36})$/;

export type DestinationCheck =
  | { ok: true; path: string }
  | { ok: false; reason: "foreign_shop" | "foreign_product" | "malformed" };

/**
 * Validates a requested destination against the seller's own shop.
 *
 * Accepts the shop's storefront root or one of its products, and nothing else.
 * Returns the normalized path so callers store a consistent value.
 */
export async function checkDestination(
  supabase: SupabaseClient,
  sellerAccountId: string,
  shop: { slug: string },
  requested: string,
): Promise<DestinationCheck> {
  const path = `/${String(requested ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "")}`;

  // The storefront root is always fair game.
  if (path === `/${shop.slug}`) return { ok: true, path };

  const match = PRODUCT_PATH.exec(path);
  if (!match) return { ok: false, reason: "malformed" };

  const [, slug, productId] = match;
  if (slug !== shop.slug) return { ok: false, reason: "foreign_shop" };

  // The slug matching is not enough on its own: a product id from another shop
  // under your own slug still 404s, which is precisely the shape of the broken
  // rows in production.
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();

  return product ? { ok: true, path } : { ok: false, reason: "foreign_product" };
}

/** What to tell the seller when a destination is refused. */
export const DESTINATION_REFUSED =
  "A tracked link can only point at your own shop or one of your products.";
