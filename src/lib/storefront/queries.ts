import "server-only";

import { createClient } from "@supabase/supabase-js";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Public storefront configuration is missing.");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getPublicShop(slug: string) {
  const { data, error } = await publicClient()
    .from("shops")
    .select("id, slug, display_name, country, currency, published_at, shop_branding(accent_color,surface_color,font_family,logo_path,banner_path,hide_snapduka_branding)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) throw new Error("Unable to load this shop.", { cause: error });
  return data;
}

export async function getPublicProducts(
  shopId: string,
  options: { search?: string; collection?: string; page?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = 24;
  const client = publicClient();
  let productIds: string[] | null = null;

  if (options.collection) {
    const { data: collection } = await client
      .from("collections")
      .select("collection_products(product_id)")
      .eq("shop_id", shopId)
      .eq("slug", options.collection)
      .eq("active", true)
      .maybeSingle();
    productIds =
      collection?.collection_products?.map(
        (item: { product_id: string }) => item.product_id,
      ) ?? [];
  }

  let query = client
    .from("products")
    .select(
      "id, name, slug, description, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity, product_media(object_path, alt_text, position)",
    )
    .eq("shop_id", shopId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (options.search?.trim()) query = query.ilike("name", `%${options.search.trim()}%`);
  if (productIds) query = query.in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data, error } = await query;
  if (error) throw new Error("Unable to load products.", { cause: error });
  return data ?? [];
}

export async function getPublicProduct(shopId: string, productId: string) {
  const { data, error } = await publicClient()
    .from("products")
    .select(
      "id, name, slug, description, currency, price_minor, inventory_policy, stock_quantity, reserved_quantity, product_media(object_path, alt_text, position), product_variants(id, name, sku, price_minor, image_path, inventory_policy, stock_quantity, reserved_quantity)",
    )
    .eq("shop_id", shopId)
    .eq("id", productId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error("Unable to load this product.", { cause: error });
  return data;
}
