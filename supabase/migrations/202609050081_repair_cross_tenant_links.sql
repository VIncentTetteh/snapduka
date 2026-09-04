-- supabase/migrations/202609050081_repair_cross_tenant_links.sql
--
-- Put eight tracked links back on the shop that owns them.
--
-- Nothing ever checked that `campaign_links.shop_id` belonged to the same
-- seller as `campaign_links.seller_account_id`, and eight rows drifted apart:
-- all owned by one seller, all carrying a different seller's shop. Two
-- `campaigns` rows inherited it from the backfill in 202609040076, which copied
-- shop_id straight off the links.
--
-- The visible symptom was a dead link. `/l/<token>` resolved and redirected to
-- `/<other-seller-slug>/products/<a product this seller owns>`, and the
-- storefront filters a product by the shop in the path — so every scan of those
-- four QR codes landed on "This shop or product is not available", while the
-- click was still recorded against the seller who minted it.
--
-- The owner is the part that is right: the product the four product-links point
-- at genuinely belongs to the seller named on the row. Only the shop is wrong,
-- so the repair moves the link to that seller's own shop and rewrites the slug
-- in destination_path to match. All eight become live and correct, and their
-- click history is untouched.
--
-- Written against the condition rather than the ids, so it is a statement about
-- what must be true rather than a one-off patch — and it is a no-op on any
-- database where the condition already holds. Sellers with more than one shop
-- are deliberately skipped: there would be no way to tell which shop was meant.

with owner_shop as (
  -- Only unambiguous cases: exactly one shop for that seller.
  -- count(*) = 1 below guarantees a single row; min() has no uuid overload.
  select seller_account_id, (array_agg(id))[1] as shop_id, (array_agg(slug))[1] as slug
  from public.shops
  group by seller_account_id
  having count(*) = 1
),
mismatched as (
  select l.id,
         l.destination_path,
         wrong.slug as wrong_slug,
         owner_shop.shop_id as right_shop_id,
         owner_shop.slug as right_slug
  from public.campaign_links l
  join public.shops wrong on wrong.id = l.shop_id
  join owner_shop on owner_shop.seller_account_id = l.seller_account_id
  where wrong.seller_account_id <> l.seller_account_id
)
update public.campaign_links l
set shop_id = m.right_shop_id,
    destination_path = case
      when m.destination_path = '/' || m.wrong_slug then '/' || m.right_slug
      when m.destination_path like '/' || m.wrong_slug || '/%'
        then '/' || m.right_slug || substring(m.destination_path from char_length(m.wrong_slug) + 2)
      else m.destination_path
    end
from mismatched m
where l.id = m.id;

with owner_shop as (
  select seller_account_id, (array_agg(id))[1] as shop_id
  from public.shops
  group by seller_account_id
  having count(*) = 1
)
update public.campaigns c
set shop_id = owner_shop.shop_id
from owner_shop, public.shops wrong
where owner_shop.seller_account_id = c.seller_account_id
  and wrong.id = c.shop_id
  and wrong.seller_account_id <> c.seller_account_id;

-- The constraints in the next migration cannot apply unless this worked, so
-- fail here rather than there, where the error would name a table instead of a
-- cause.
do $$
declare bad_links bigint; bad_campaigns bigint;
begin
  select count(*) into bad_links
  from public.campaign_links l join public.shops s on s.id = l.shop_id
  where s.seller_account_id <> l.seller_account_id;

  select count(*) into bad_campaigns
  from public.campaigns c join public.shops s on s.id = c.shop_id
  where s.seller_account_id <> c.seller_account_id;

  if bad_links > 0 or bad_campaigns > 0 then
    raise exception
      'Cross-tenant rows remain after repair: % campaign_links, % campaigns. A seller with more than one shop cannot be repaired automatically.',
      bad_links, bad_campaigns;
  end if;
end $$;
