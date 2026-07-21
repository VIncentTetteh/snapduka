begin;

set local search_path = extensions, public;

select plan(7);

select has_column('public', 'products', 'cost_minor', 'products has cost_minor');
select col_type_is('public', 'products', 'cost_minor', 'bigint', 'cost_minor is bigint');
select has_column('public', 'order_lines', 'unit_cost_minor', 'order_lines has unit_cost_minor');
select col_type_is('public', 'order_lines', 'unit_cost_minor', 'bigint', 'unit_cost_minor is bigint');

-- Fixture-seeding convention (auth.users + seller_accounts + shops +
-- fulfillment_methods + products with fixed
-- 00000000-0000-0000-0000-000000016xxx ids) matches 004_catalog_rls.test.sql.
-- Created before the throws_ok below so its "from public.shops limit 1"
-- subquery has a row to draw shop_id/seller_account_id/currency from —
-- public.shops is empty at the start of every test file's own transaction
-- (seed.sql seeds no shops).
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000016101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cost-fixture@example.com', '',
  now(), '{}'::jsonb, now(), now()
);

insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000016201',
  '00000000-0000-0000-0000-000000016101',
  'GH', 'active', true, 'Cost Fixture Seller',
  'cost-fixture@example.com', '+233241234580'
);

insert into public.shops (
  id, seller_account_id, slug, display_name, legal_name,
  country, currency, status, published_at
)
values (
  '00000000-0000-0000-0000-000000016301',
  '00000000-0000-0000-0000-000000016201',
  'cost-fixture-shop', 'Cost Fixture Shop', 'Cost Fixture Shop Ltd',
  'GH', 'GHS', 'published', now()
);

insert into public.fulfillment_methods (
  id, shop_id, seller_account_id, type, name, fee_minor, active
)
values (
  '00000000-0000-0000-0000-000000016501',
  '00000000-0000-0000-0000-000000016301',
  '00000000-0000-0000-0000-000000016201',
  'pickup', 'Store Pickup', 0, true
);

select throws_ok(
  $$ insert into public.products (shop_id, seller_account_id, name, slug, currency, price_minor, cost_minor)
     select id, seller_account_id, 'Bad cost', 'bad-cost-test', currency, 1000, -1 from public.shops limit 1 $$,
  '23514',
  null,
  'negative cost_minor is rejected by products_cost_check'
);

-- Behavioral: create_guest_order snapshots cost_minor at that moment, and a
-- LATER change to products.cost_minor does not retroactively alter the
-- already-inserted order_lines row.
insert into public.products (
  id, shop_id, seller_account_id, name, slug, description,
  currency, price_minor, cost_minor, status, inventory_policy, stock_quantity, published_at
)
values (
  '00000000-0000-0000-0000-000000016401',
  '00000000-0000-0000-0000-000000016301',
  '00000000-0000-0000-0000-000000016201',
  'Cost Fixture Product', 'cost-fixture-product', '',
  'GHS', 2000, 500, 'active', 'track', 10, now()
);

select public.create_guest_order(
  '00000000-0000-0000-0000-000000016301'::uuid,
  '00000000-0000-0000-0000-000000016501'::uuid,
  '{"name":"Cost Fixture Buyer","email":"cost-buyer@example.com","phone":"+233241234599","country":"GH","marketingConsent":false}'::jsonb,
  '[{"productId":"00000000-0000-0000-0000-000000016401","quantity":1}]'::jsonb,
  'cost-fixture-order-key',
  'cash_on_delivery'
);

select is(
  (select unit_cost_minor from public.order_lines where product_id = '00000000-0000-0000-0000-000000016401'),
  500::bigint,
  'create_guest_order snapshots products.cost_minor onto order_lines.unit_cost_minor at time of sale'
);

update public.products set cost_minor = 900
where id = '00000000-0000-0000-0000-000000016401';

select is(
  (select unit_cost_minor from public.order_lines where product_id = '00000000-0000-0000-0000-000000016401'),
  500::bigint,
  'order_lines.unit_cost_minor stays snapshotted after products.cost_minor is later changed'
);

select * from finish();
rollback;
