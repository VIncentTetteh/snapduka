import "server-only";

import { isFeatureEnabled } from "@/lib/flags";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type CategoryOption = { id: string; name: string };

/**
 * Bounded explicitly — an unbounded read is capped silently at db.max_rows —
 * and matching the cap Snap-to-list shows the model, so every category the
 * model can suggest is one the form can display.
 */
export const MAX_CATEGORY_OPTIONS = 400;

/**
 * The active taxonomy for the product forms, or [] while `product_categories`
 * is off for this seller (an empty list hides the field). Read with the
 * seller's own client: categories_public_read already exposes active rows.
 */
export async function loadCategoryOptions(supabase: ServerSupabase, sellerAccountId: string): Promise<CategoryOption[]> {
  if (!(await isFeatureEnabled("product_categories", { sellerAccountId }))) return [];
  const { data, error } = await supabase
    .from("categories")
    .select("id,name")
    .eq("active", true)
    .order("position")
    .order("name")
    .limit(MAX_CATEGORY_OPTIONS);
  if (error) {
    console.error("[catalog] categories failed", { code: error.code });
    return [];
  }
  return data ?? [];
}
