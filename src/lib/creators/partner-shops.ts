import { createClient } from "@/lib/supabase/server";

export type PartnerShop = { displayName: string; slug: string };

/**
 * Names the shops behind a creator's partnerships and payments.
 *
 * Neither creator_partnerships nor creator_commission_payments has a foreign
 * key to shops — both reach it through seller_account_id — so PostgREST cannot
 * embed `shops(...)` from either. Only campaign_links, which carries a real
 * shop_id, can. Hence one explicit lookup rather than an embed that typechecks
 * and then returns a relation error at runtime.
 *
 * Scoped by RLS: shops_creator_partner_read (migration 202609020074) exposes
 * exactly the shops this creator partners with, including ones that are not
 * published, which shops_public_read would hide.
 */
export async function fetchPartnerShops(
  sellerAccountIds: string[],
): Promise<Map<string, PartnerShop>> {
  const unique = [...new Set(sellerAccountIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const { data } = await supabase
    .from("shops")
    .select("seller_account_id,display_name,slug")
    .in("seller_account_id", unique);

  return new Map(
    (data ?? []).map((shop) => [
      shop.seller_account_id,
      { displayName: shop.display_name, slug: shop.slug },
    ]),
  );
}
