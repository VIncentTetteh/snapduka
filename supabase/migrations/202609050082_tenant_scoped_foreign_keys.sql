-- supabase/migrations/202609050082_tenant_scoped_foreign_keys.sql
--
-- Make a cross-tenant row impossible to write.
--
-- Almost every RLS policy here reads
-- `seller_account_id = current_seller_account_id()` — it checks the column the
-- *writer supplied*, not the row that column's neighbours point at. Send your
-- own tenant id alongside somebody else's product id and it passes. Only three
-- policies in the whole schema verify the referenced entity
-- (products_owner_insert, variants_owner_all, fulfillment_owner_all), and two
-- of those are undone anyway by the team policies, which are OR'd and re-grant
-- the row on a role test alone.
--
-- A foreign key does not care about any of that. It holds for the web app, for
-- both mobile clients — which write straight to PostgREST with the user's JWT,
-- so no server-side check can ever be put in front of them — for a future
-- migration, and for someone at a psql prompt.
--
-- The technique is already used here: shops_seller_country_fkey is
-- `(seller_account_id, country) references seller_accounts (id, country)`. And
-- two of the keys this needs have existed, unused, since day one —
-- products_id_seller_key and product_variants_id_seller_key. Somebody saw this
-- coming and never wired the other end.
--
-- Worth naming what this closes beyond tidiness: promotions_owner_all has the
-- forgeable shape, and create_guest_order_growth resolves a promotion by
-- `shop_id + code`. A seller could insert a promotion carrying their own
-- seller_account_id and a victim's shop_id, and the code became redeemable at
-- the victim's checkout, discounting the victim's orders.
--
-- Nullable referencing columns stay MATCH SIMPLE (the default): a NULL in
-- either column skips the check, which is what an unattached campaign_link or
-- a review whose customer was deleted needs.
--
-- The SET NULL actions name their column explicitly (Postgres 15+). A bare
-- SET NULL on a composite key nulls *every* referencing column, which would
-- mean nulling seller_account_id — NOT NULL on all three of these tables — and
-- the delete would fail instead of cascading.

-- ── Referenced sides ────────────────────────────────────────────────────────
-- Redundant against the primary key by design; a composite FK needs a unique
-- constraint covering exactly the pair it references.
alter table public.shops             add constraint shops_id_seller_key             unique (id, seller_account_id);
alter table public.orders            add constraint orders_id_seller_key            unique (id, seller_account_id);
alter table public.customers         add constraint customers_id_seller_key         unique (id, seller_account_id);
alter table public.campaigns         add constraint campaigns_id_seller_key         unique (id, seller_account_id);
alter table public.collections       add constraint collections_id_seller_key       unique (id, seller_account_id);
alter table public.customer_segments add constraint customer_segments_id_seller_key unique (id, seller_account_id);

-- ── shop_id must belong to the same seller ──────────────────────────────────
alter table public.products              add constraint products_shop_same_seller              foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.promotions            add constraint promotions_shop_same_seller            foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.collections           add constraint collections_shop_same_seller           foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.campaigns             add constraint campaigns_shop_same_seller             foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.campaign_links        add constraint campaign_links_shop_same_seller        foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.shop_branding         add constraint shop_branding_shop_same_seller         foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.custom_domains        add constraint custom_domains_shop_same_seller        foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.discovery_preferences add constraint discovery_preferences_shop_same_seller foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.fulfillment_methods   add constraint fulfillment_methods_shop_same_seller   foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;
alter table public.orders                add constraint orders_shop_same_seller                foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id);
alter table public.product_reviews       add constraint product_reviews_shop_same_seller       foreign key (shop_id, seller_account_id) references public.shops (id, seller_account_id) on delete cascade;

-- ── product_id must belong to the same seller ───────────────────────────────
alter table public.product_variants    add constraint product_variants_product_same_seller    foreign key (product_id, seller_account_id) references public.products (id, seller_account_id) on delete cascade;
alter table public.product_media       add constraint product_media_product_same_seller       foreign key (product_id, seller_account_id) references public.products (id, seller_account_id) on delete cascade;
alter table public.collection_products add constraint collection_products_product_same_seller foreign key (product_id, seller_account_id) references public.products (id, seller_account_id) on delete cascade;
alter table public.campaign_products   add constraint campaign_products_product_same_seller   foreign key (product_id, seller_account_id) references public.products (id, seller_account_id) on delete cascade;
alter table public.product_reviews     add constraint product_reviews_product_same_seller     foreign key (product_id, seller_account_id) references public.products (id, seller_account_id) on delete cascade;

-- ── order_id must belong to the same seller ─────────────────────────────────
alter table public.shipments       add constraint shipments_order_same_seller       foreign key (order_id, seller_account_id) references public.orders (id, seller_account_id);
alter table public.courier_quotes  add constraint courier_quotes_order_same_seller  foreign key (order_id, seller_account_id) references public.orders (id, seller_account_id);
alter table public.product_reviews add constraint product_reviews_order_same_seller foreign key (order_id, seller_account_id) references public.orders (id, seller_account_id) on delete cascade;

-- ── customer_id must belong to the same seller ──────────────────────────────
alter table public.customer_tags   add constraint customer_tags_customer_same_seller   foreign key (customer_id, seller_account_id) references public.customers (id, seller_account_id) on delete cascade;
alter table public.orders          add constraint orders_customer_same_seller          foreign key (customer_id, seller_account_id) references public.customers (id, seller_account_id);
alter table public.product_reviews add constraint product_reviews_customer_same_seller foreign key (customer_id, seller_account_id) references public.customers (id, seller_account_id) on delete set null (customer_id);

-- ── the rest ────────────────────────────────────────────────────────────────
alter table public.campaign_links      add constraint campaign_links_campaign_same_seller      foreign key (campaign_id, seller_account_id) references public.campaigns (id, seller_account_id) on delete set null (campaign_id);
alter table public.campaign_products   add constraint campaign_products_campaign_same_seller   foreign key (campaign_id, seller_account_id) references public.campaigns (id, seller_account_id) on delete cascade;
alter table public.collection_products add constraint collection_products_collection_same_seller foreign key (collection_id, seller_account_id) references public.collections (id, seller_account_id) on delete cascade;
alter table public.marketing_broadcasts add constraint broadcasts_segment_same_seller          foreign key (segment_id, seller_account_id) references public.customer_segments (id, seller_account_id) on delete set null (segment_id);
