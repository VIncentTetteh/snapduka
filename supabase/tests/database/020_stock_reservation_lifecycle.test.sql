-- supabase/tests/database/020_stock_reservation_lifecycle.test.sql
begin;

set local search_path = extensions, public;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000020101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stock-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000020201','00000000-0000-0000-0000-000000020101','GH','active',true,'Stock Fixture Seller','stock-fixture@example.com','+233241234582');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','stock-fixture-shop','Stock Fixture Shop','Stock Fixture Shop Ltd','GH','GHS','published',now());

insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity, published_at)
values ('00000000-0000-0000-0000-000000020401','00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','Stock Fixture Product','stock-fixture-product','GHS',5000,'active','track',10,0,now());

-- Second fixture: a non-track product (continue_selling). reserve_product_stock
-- never increments reserved_quantity for these, so finish_stock_reservation
-- must not decrement it either, or reserved_quantity goes negative and trips
-- products_stock_check the moment the order is finalized.
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity, published_at)
values ('00000000-0000-0000-0000-000000020402','00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','Stock Fixture Product Non-Track','stock-fixture-product-non-track','GHS',5000,'active','continue_selling',null,0,now());

-- Reserve stock the same way create_guest_order does.
select public.reserve_product_stock(
  '00000000-0000-0000-0000-000000020401', null, 3,
  'order:00000000-0000-0000-0000-000000020501:00000000-0000-0000-0000-000000020401:base',
  now() + interval '30 minutes'
);

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  3,
  'reserving stock increments reserved_quantity'
);

-- Finalize as consumed (simulating a successful payment) — reserved_quantity
-- drops back to 0 AND stock_quantity actually decrements.
select public.finalize_order_stock('00000000-0000-0000-0000-000000020501', 'consumed');

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  0,
  'finalize_order_stock(consumed) releases the reservation hold'
);
select is(
  (select stock_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  7,
  'finalize_order_stock(consumed) actually decrements stock_quantity'
);

-- Calling it again is a safe no-op (finish_stock_reservation checks
-- status <> 'active' and returns early) — proves idempotency so calling
-- this from both apply_paystack_success and updateOrderAction is safe.
select lives_ok(
  $$ select public.finalize_order_stock('00000000-0000-0000-0000-000000020501', 'consumed') $$,
  'calling finalize_order_stock twice for the same order does not error'
);

-- Reserve stock on the non-track product — reserve_product_stock's own
-- inventory_policy = 'track' gate means reserved_quantity is left untouched.
select public.reserve_product_stock(
  '00000000-0000-0000-0000-000000020402', null, 2,
  'order:00000000-0000-0000-0000-000000020502:00000000-0000-0000-0000-000000020402:base',
  now() + interval '30 minutes'
);

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020402'),
  0,
  'reserving stock on a non-track product leaves reserved_quantity at 0'
);

-- Finalizing that reservation must not attempt to decrement reserved_quantity
-- below 0 (which would violate products_stock_check and, in production,
-- roll back the whole apply_paystack_success transaction).
select lives_ok(
  $$ select public.finalize_order_stock('00000000-0000-0000-0000-000000020502', 'consumed') $$,
  'finalizing a non-track product reservation does not raise a stock check violation'
);

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020402'),
  0,
  'finalize_order_stock(consumed) leaves reserved_quantity at 0 for a non-track product'
);

select * from finish();
rollback;
