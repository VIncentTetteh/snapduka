-- Releasing stock is only correct for an order that will never be fulfilled.
--
-- The sweep used to release every expired reservation regardless of its order.
-- finalize_order_stock only consumes reservations that are still `active`, so
-- once the sweep had run there was nothing left to consume and
-- products.stock_quantity was never decremented. Production carried four
-- released reservations belonging to `completed` orders, three of them paid —
-- those sellers' stock counts never moved, and they could oversell without
-- limit.
--
-- The case that matters most in these markets is `offline_due`: a cash-on-
-- delivery order is unpaid for days by design, and most live shops take no
-- online payment at all. Releasing its stock is the bug at its worst.

begin;

set local search_path = extensions, public;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('aaaa0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'inventory@rpc.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('bbbb0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Inventory Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('cccc0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001',
        'inventory-shop', 'Inventory Shop', 'GH', 'GHS', 'published', now());

insert into public.products (id, shop_id, seller_account_id, name, slug, currency,
                             price_minor, status, published_at, stock_quantity)
values ('dddd0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001',
        'bbbb0000-0000-4000-8000-000000000001', 'Rice', 'rice', 'GHS', 1000, 'active', now(), 100);

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('eeee0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001',
        'Ama', 'ama@inventory.test', '+233201234598', 'GH');

-- Four orders covering the states the rule turns on.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values
  ('ffff0000-0000-4000-8000-00000000000a', 'cccc0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
   'GHS', 'pending', 'unpaid', 'unconfirmed', 'paystack', 1000, 0, 1000,
   '{}'::jsonb, '{"type":"pickup"}'::jsonb),
  ('ffff0000-0000-4000-8000-00000000000b', 'cccc0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
   'GHS', 'pending', 'offline_due', 'unconfirmed', 'cash_on_delivery', 1000, 0, 1000,
   '{}'::jsonb, '{"type":"pickup"}'::jsonb),
  ('ffff0000-0000-4000-8000-00000000000c', 'cccc0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
   'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 1000, 0, 1000,
   '{}'::jsonb, '{"type":"pickup"}'::jsonb),
  ('ffff0000-0000-4000-8000-00000000000d', 'cccc0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
   'GHS', 'cancelled', 'unpaid', 'cancelled', 'paystack', 1000, 0, 1000,
   '{}'::jsonb, '{"type":"pickup"}'::jsonb);

-- One expired reservation each, in the reference shape create_guest_order writes.
insert into public.stock_reservations (id, product_id, seller_account_id, quantity, status, reference, expires_at)
select
  ('11110000-0000-4000-8000-00000000000' || suffix)::uuid,
  'dddd0000-0000-4000-8000-000000000001',
  'bbbb0000-0000-4000-8000-000000000001',
  1, 'active',
  'order:ffff0000-0000-4000-8000-00000000000' || suffix || ':dddd0000-0000-4000-8000-000000000001:base',
  now() - interval '1 hour'
from unnest(array['a', 'b', 'c', 'd']) as suffix;

select is(
  (select count(*) from public.release_abandoned_reservations(100)),
  2::bigint,
  'only the abandoned and the cancelled order are released'
);

select is(
  (select status from public.stock_reservations where id = '11110000-0000-4000-8000-00000000000a'),
  'released',
  'an abandoned checkout gives its stock back'
);

select is(
  (select status from public.stock_reservations where id = '11110000-0000-4000-8000-00000000000d'),
  'released',
  'a cancelled order gives its stock back'
);

-- The two that were silently wrong before.
select is(
  (select status from public.stock_reservations where id = '11110000-0000-4000-8000-00000000000b'),
  'active',
  'a cash-on-delivery order keeps its stock reserved, however long it waits'
);

select is(
  (select status from public.stock_reservations where id = '11110000-0000-4000-8000-00000000000c'),
  'active',
  'a PAID order keeps its stock reserved so it can still be consumed'
);

-- And the point of holding it: finalize can still take the stock afterwards.
select public.finalize_order_stock('ffff0000-0000-4000-8000-00000000000c', 'consumed');

select is(
  (select stock_quantity from public.products where id = 'dddd0000-0000-4000-8000-000000000001'),
  99,
  'completing the paid order actually decrements stock'
);

select * from finish();

rollback;
