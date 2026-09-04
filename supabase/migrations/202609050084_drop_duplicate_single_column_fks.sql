-- Drop the single-column foreign keys the composite keys replaced.
--
-- 202609050082 added 26 tenant-scoped composite keys *alongside* the existing
-- single-column ones, which left two foreign keys between each pair of tables.
-- PostgREST resolves an embed by finding the relationship between two tables,
-- so two of them made every nested select ambiguous:
--
--   PGRST201: Could not embed because more than one relationship was found
--             for 'products' and 'product_media'
--
-- That is not a warning, it is a 300 from PostgREST and a 500 from the page. It
-- took down every storefront and product page — `products(...)`,
-- `product_media(...)`, `order_lines(...)`, every embed in the app — for the
-- fifteen minutes between deploying 82 and this. The constraints were correct;
-- having two of them was not.
--
-- Dropping the single-column key loses nothing. A composite key over
-- (x_id, seller_account_id) is strictly stronger than one over (x_id): it
-- enforces the same reference plus tenancy. MATCH SIMPLE skips the check when
-- any referencing column is NULL, which would matter if the tenant column were
-- nullable — it is NOT NULL on all nineteen of these tables, verified — so the
-- only rows skipped are those where x_id itself is NULL, which is exactly what
-- the single-column key permitted too.
--
-- Delete actions were compared one by one and every pair already agreed, with a
-- single exception handled first, below.

-- marketing_broadcasts.segment_id was NO ACTION and I gave the composite key
-- SET NULL. With both present the stricter one won, so nothing changed and
-- nothing failed; dropping the old key would have quietly turned "you cannot
-- delete a segment a broadcast refers to" into "deleting it detaches the
-- broadcast". That is a real behaviour change and it was not asked for, so the
-- composite key is rebuilt to match what the schema already said.
alter table public.marketing_broadcasts drop constraint broadcasts_segment_same_seller;
alter table public.marketing_broadcasts add constraint broadcasts_segment_same_seller
  foreign key (segment_id, seller_account_id)
  references public.customer_segments (id, seller_account_id);

alter table public.campaign_links        drop constraint campaign_links_campaign_id_fkey;
alter table public.campaign_links        drop constraint campaign_links_shop_id_fkey;
alter table public.campaign_products     drop constraint campaign_products_campaign_id_fkey;
alter table public.campaign_products     drop constraint campaign_products_product_id_fkey;
alter table public.campaigns             drop constraint campaigns_shop_id_fkey;
alter table public.collection_products   drop constraint collection_products_collection_id_fkey;
alter table public.collection_products   drop constraint collection_products_product_id_fkey;
alter table public.collections           drop constraint collections_shop_id_fkey;
alter table public.courier_quotes        drop constraint courier_quotes_order_id_fkey;
alter table public.custom_domains        drop constraint custom_domains_shop_id_fkey;
alter table public.customer_tags         drop constraint customer_tags_customer_id_fkey;
alter table public.discovery_preferences drop constraint discovery_preferences_shop_id_fkey;
alter table public.fulfillment_methods   drop constraint fulfillment_methods_shop_id_fkey;
alter table public.marketing_broadcasts  drop constraint marketing_broadcasts_segment_id_fkey;
alter table public.orders                drop constraint orders_customer_id_fkey;
alter table public.orders                drop constraint orders_shop_id_fkey;
alter table public.product_media         drop constraint product_media_product_id_fkey;
alter table public.product_reviews       drop constraint product_reviews_customer_id_fkey;
alter table public.product_reviews       drop constraint product_reviews_order_id_fkey;
alter table public.product_reviews       drop constraint product_reviews_product_id_fkey;
alter table public.product_reviews       drop constraint product_reviews_shop_id_fkey;
alter table public.product_variants      drop constraint product_variants_product_id_fkey;
alter table public.products              drop constraint products_shop_id_fkey;
alter table public.promotions            drop constraint promotions_shop_id_fkey;
alter table public.shipments             drop constraint shipments_order_id_fkey;
alter table public.shop_branding         drop constraint shop_branding_shop_id_fkey;

-- Assert the property PostgREST actually needs. This is the check that was
-- missing from 82, and it is why that migration passed a rollback replay and
-- still broke production.
--
-- The property is not "one foreign key per pair of tables" — three pairs here
-- legitimately have two, over *different* columns (plan_id and pending_plan_id,
-- price_id and pending_price_id, the reserve and settle ledger transactions).
-- PostgREST handles those; the app already disambiguates them as `plans!plan_id`
-- and so on. What it cannot resolve is two keys whose referencing columns
-- overlap, because then the same column pair describes both relationships.
do $$
declare dupes text;
begin
  with fk as (
    select oid, conrelid, confrelid,
           conrelid::regclass::text as tbl, confrelid::regclass::text as ref,
           conname, conkey
    from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace
  )
  select string_agg(format('%s -> %s (%s / %s)', a.tbl, a.ref, a.conname, b.conname), ', ')
  into dupes
  from fk a
  join fk b
    on a.conrelid = b.conrelid
   and a.confrelid = b.confrelid
   and a.oid < b.oid
   and a.conkey && b.conkey;

  if dupes is not null then
    raise exception 'Ambiguous PostgREST embeds remain: %', dupes;
  end if;
end $$;
