-- Tenant isolation, enforced where it cannot be bypassed.
--
-- Almost every RLS policy here checks the tenant column the *writer supplied*,
-- not the row that column's neighbours point at. Send your own
-- seller_account_id alongside somebody else's product id and it passes. The
-- team policies make it worse: they are OR'd with the owner policies and
-- re-grant a row on a role test alone.
--
-- So these assertions are deliberately made as a *privileged* caller with RLS
-- out of the picture. Anything that still fails here fails for the web app, for
-- both mobile clients — which write straight to PostgREST with the user's JWT,
-- so no server-side check can be put in front of them — and for anyone at a
-- psql prompt. That is the property being claimed.
--
-- Two seller accounts, two shops, one product each.

begin;

set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a9a90000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'tenant-a@iso.test', now(), now()),
       ('a9a90000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'tenant-b@iso.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('b9b90000-0000-4000-8000-000000000001', 'a9a90000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Seller A'),
       ('b9b90000-0000-4000-8000-000000000002', 'a9a90000-0000-4000-8000-000000000002',
        'GH', 'active', true, 'Seller B');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c9c90000-0000-4000-8000-000000000001', 'b9b90000-0000-4000-8000-000000000001',
        'iso-shop-a', 'Shop A', 'GH', 'GHS', 'published', now()),
       ('c9c90000-0000-4000-8000-000000000002', 'b9b90000-0000-4000-8000-000000000002',
        'iso-shop-b', 'Shop B', 'GH', 'GHS', 'published', now());

-- products_published_check wants published_at on an active row; products_stock_check
-- wants a stock_quantity, because inventory_policy defaults to 'track'.
insert into public.products (id, seller_account_id, shop_id, name, slug, status, price_minor, currency, published_at, stock_quantity)
values ('d9d90000-0000-4000-8000-000000000001', 'b9b90000-0000-4000-8000-000000000001',
        'c9c90000-0000-4000-8000-000000000001', 'A shirt', 'a-shirt', 'active', 5000, 'GHS', now(), 10),
       ('d9d90000-0000-4000-8000-000000000002', 'b9b90000-0000-4000-8000-000000000002',
        'c9c90000-0000-4000-8000-000000000002', 'B shirt', 'b-shirt', 'active', 5000, 'GHS', now(), 10);

insert into public.campaigns (id, seller_account_id, shop_id, name, status)
values ('e9e90000-0000-4000-8000-000000000001', 'b9b90000-0000-4000-8000-000000000001',
        'c9c90000-0000-4000-8000-000000000001', 'A campaign', 'active');

-- ── The money case ──────────────────────────────────────────────────────────
-- create_guest_order_growth resolves a promotion by shop_id + code. Without the
-- composite key, A could mint a promotion carrying their own seller_account_id
-- and B's shop_id, and the code became redeemable at B's checkout — discounting
-- B's orders at A's choosing.
select throws_ok(
  $$insert into public.promotions (seller_account_id, shop_id, name, code, kind, value, active)
    values ('b9b90000-0000-4000-8000-000000000001', 'c9c90000-0000-4000-8000-000000000002',
            'Steal', 'STEAL50', (enum_range(null::public.discount_kind))[1], 10, true)$$,
  '23503',
  NULL,
  'a promotion cannot carry another seller''s shop'
);

select lives_ok(
  $$insert into public.promotions (seller_account_id, shop_id, name, code, kind, value, active)
    values ('b9b90000-0000-4000-8000-000000000001', 'c9c90000-0000-4000-8000-000000000001',
            'Mine', 'MINE10', (enum_range(null::public.discount_kind))[1], 10, true)$$,
  'a promotion on the seller''s own shop is still fine'
);

-- ── The catalogue cases ─────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.campaign_products (seller_account_id, campaign_id, product_id)
    values ('b9b90000-0000-4000-8000-000000000001', 'e9e90000-0000-4000-8000-000000000001',
            'd9d90000-0000-4000-8000-000000000002')$$,
  '23503',
  NULL,
  'a campaign cannot feature another seller''s product'
);

-- RLS alone permits this one today: variants_owner_all is OR'd with a team
-- policy that grants any `catalog` member the row on a role test alone.
select throws_ok(
  $$insert into public.product_variants (seller_account_id, product_id, name, sku, price_minor, stock_quantity)
    values ('b9b90000-0000-4000-8000-000000000001', 'd9d90000-0000-4000-8000-000000000002',
            'Large', 'ISO-L', 5000, 4)$$,
  '23503',
  NULL,
  'a variant cannot be attached to another seller''s product'
);

select throws_ok(
  $$insert into public.product_media (seller_account_id, product_id, object_path, width, height, position)
    values ('b9b90000-0000-4000-8000-000000000001', 'd9d90000-0000-4000-8000-000000000002',
            'b9b90000/iso.jpg', 800, 800, 0)$$,
  '23503',
  NULL,
  'media cannot be attached to another seller''s product'
);

-- ── The tracked link, which is what surfaced all of this ────────────────────
select throws_ok(
  $$insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path)
    values ('b9b90000-0000-4000-8000-000000000001', 'c9c90000-0000-4000-8000-000000000002',
            'Stolen', 'isotest-a', 'whatsapp', '/iso-shop-b')$$,
  '23503',
  NULL,
  'a tracked link cannot carry another seller''s shop'
);

-- shop_id is right, so no FK fires. Only the trigger catches this one — and it
-- is the exact shape of the eight rows repaired in 202609050081, where the link
-- resolved and redirected buyers onto a shop that did not have the product.
select throws_ok(
  $$insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path)
    values ('b9b90000-0000-4000-8000-000000000001', 'c9c90000-0000-4000-8000-000000000001',
            'Wrong path', 'isotest-b', 'whatsapp', '/iso-shop-b/products/d9d90000-0000-4000-8000-000000000002')$$,
  '23514',
  NULL,
  'a tracked link cannot point at another seller''s storefront'
);

select lives_ok(
  $$insert into public.campaign_links (seller_account_id, shop_id, name, token, channel, destination_path)
    values ('b9b90000-0000-4000-8000-000000000001', 'c9c90000-0000-4000-8000-000000000001',
            'Right path', 'isotest-c', 'whatsapp', '/iso-shop-a/products/d9d90000-0000-4000-8000-000000000001')$$,
  'a link into the seller''s own shop is still fine'
);

select * from finish();
rollback;
