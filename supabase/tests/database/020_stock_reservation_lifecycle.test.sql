-- supabase/tests/database/020_stock_reservation_lifecycle.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000020101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stock-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000020201','00000000-0000-0000-0000-000000020101','GH','active',true,'Stock Fixture Seller','stock-fixture@example.com','+233241234582');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','stock-fixture-shop','Stock Fixture Shop','Stock Fixture Shop Ltd','GH','GHS','published',now());

insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity, published_at)
values ('00000000-0000-0000-0000-000000020401','00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','Stock Fixture Product','stock-fixture-product','GHS',5000,'active','track',10,0,now());

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

select * from finish();
rollback;
