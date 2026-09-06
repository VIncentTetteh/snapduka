-- Cover the tenant-scoped foreign keys with indexes.
--
-- 202609050082 added 26 composite keys over (x_id, seller_account_id) and no
-- indexes to match. Postgres enforces a foreign key by looking up the
-- referencing rows whenever the parent row is deleted or its key changes, so an
-- uncovered key turns every such delete into a scan of the child table.
--
-- Where an index already led with the FK's first column, the planner reaches the
-- rows by index and filters the second column, which is fine. Ten of the keys
-- had no index on their first column at all, so the only plan available is a
-- scan of the whole child table — confirmed against production:
--
--   explain select 1 from product_media
--   where product_id = ... and seller_account_id = ... for key share;
--   ->  Seq Scan on product_media
--
-- That runs on the path of deleting a single product. Being honest about the
-- size of it: product_media holds ten rows today, and at ten rows a sequential
-- scan is genuinely the cheaper plan — the planner is right to choose it and
-- will keep choosing it after this migration. What matters is that without an
-- index there is no other plan to switch to, so the cost grows with the table
-- and is paid while holding locks. The same shape sits behind deleting a shop
-- (orders, campaign_links, custom_domains, fulfillment_methods) and a customer
-- (orders, product_reviews).
--
-- Verified with enable_seqscan off that the new index satisfies both columns as
-- an Index Cond rather than a filter, so it covers the check completely.
--
-- Indexes are built for the *composite*, not just the leading column: the
-- second column then satisfies the check from the index alone rather than
-- fetching the heap row, and a composite index still serves leading-column
-- lookups, so nothing else is lost.
--
-- CONCURRENTLY is deliberately not used — these tables are small, the whole
-- migration runs in well under a second, and a non-concurrent build keeps the
-- migration transactional.

create index if not exists campaign_links_shop_seller_idx
  on public.campaign_links (shop_id, seller_account_id);

create index if not exists collection_products_product_seller_idx
  on public.collection_products (product_id, seller_account_id);

create index if not exists courier_quotes_order_seller_idx
  on public.courier_quotes (order_id, seller_account_id);

create index if not exists custom_domains_shop_seller_idx
  on public.custom_domains (shop_id, seller_account_id);

create index if not exists fulfillment_methods_shop_seller_idx
  on public.fulfillment_methods (shop_id, seller_account_id);

create index if not exists marketing_broadcasts_segment_seller_idx
  on public.marketing_broadcasts (segment_id, seller_account_id);

create index if not exists orders_shop_seller_idx
  on public.orders (shop_id, seller_account_id);

create index if not exists orders_customer_seller_idx
  on public.orders (customer_id, seller_account_id);

create index if not exists product_media_product_seller_idx
  on public.product_media (product_id, seller_account_id);

create index if not exists product_reviews_customer_seller_idx
  on public.product_reviews (customer_id, seller_account_id);

-- The remaining composite keys already have an index leading with their first
-- column, so the planner reaches the rows by index and filters the tenant
-- column. Adding a second index for each would cost write throughput on the
-- hottest tables to save a filter on a handful of rows, which is the wrong
-- trade.
--
-- shops_country_currency_fkey is left alone deliberately: country_configs holds
-- one row per market, so a scan of it is three rows.

-- The property: no foreign key whose leading column is unindexed may reference
-- a table large enough for that to matter. Asserted for the tenant keys, which
-- is what this migration is about.
do $$
declare uncovered text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ')
  into uncovered
  from pg_constraint c
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and array_length(c.conkey, 1) = 2
    and c.conname like '%same_seller%'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1]
    );

  if uncovered is not null then
    raise exception 'Tenant foreign keys still have an unindexed leading column: %', uncovered;
  end if;
end $$;
