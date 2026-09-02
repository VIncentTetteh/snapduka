-- Device push tokens decide who receives a seller's order notifications, so the
-- table is service-role write only.
--
-- 202607210041 exists because push_subscriptions once had an open insert policy:
-- anyone could attach their own endpoint to another seller's account and read
-- their order flow. This table must not repeat that, and the fan-out added to
-- enqueue_order_notification has to produce exactly one row per active device —
-- no rows for a device that signed out, and none belonging to another seller.

begin;

set local search_path = extensions, public;

select plan(13);

-- ---------------------------------------------------------------------------
-- Two sellers, so cross-tenant leakage is testable rather than assumed.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('a1a10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'push-a@device.test', now(), now()),
  ('a1a10000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'push-b@device.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email)
values
  ('b1b10000-0000-4000-8000-000000000001', 'a1a10000-0000-4000-8000-000000000001',
   'GH', 'active', true, 'Seller A', 'a@device.test'),
  ('b1b10000-0000-4000-8000-000000000002', 'a1a10000-0000-4000-8000-000000000002',
   'GH', 'active', true, 'Seller B', 'b@device.test');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c1c10000-0000-4000-8000-000000000001', 'b1b10000-0000-4000-8000-000000000001',
        'push-shop', 'Push Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('d1d10000-0000-4000-8000-000000000001', 'b1b10000-0000-4000-8000-000000000001',
        'Buyer', 'buyer@device.test', '+233201234567', 'GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values (
  'e1e10000-0000-4000-8000-000000000001', 'c1c10000-0000-4000-8000-000000000001',
  'b1b10000-0000-4000-8000-000000000001', 'd1d10000-0000-4000-8000-000000000001',
  'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 10000, 0, 10000,
  '{"name":"Buyer","email":"buyer@device.test"}'::jsonb, '{"type":"delivery"}'::jsonb);

-- ---------------------------------------------------------------------------
-- Shape.
-- ---------------------------------------------------------------------------
select has_table('public', 'device_push_tokens', 'device_push_tokens exists');
select col_is_unique('public', 'device_push_tokens', 'expo_push_token',
  'a token can only ever belong to one account');

select throws_ok(
  $$insert into public.device_push_tokens (seller_account_id, auth_user_id, expo_push_token, platform)
    values ('b1b10000-0000-4000-8000-000000000001','a1a10000-0000-4000-8000-000000000001',
            'ExponentPushToken[bad]','windows')$$,
  '23514', null,
  'platform is constrained to the two we ship');

-- ---------------------------------------------------------------------------
-- Privileges. The whole point of the table.
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.device_push_tokens', 'insert'),
  'authenticated cannot register a device directly');
select ok(
  not has_table_privilege('authenticated', 'public.device_push_tokens', 'update'),
  'authenticated cannot reassign a device');
select ok(
  not has_table_privilege('authenticated', 'public.device_push_tokens', 'delete'),
  'authenticated cannot delete a device row');
select ok(
  not has_table_privilege('anon', 'public.device_push_tokens', 'select'),
  'anon cannot read device tokens');
select ok(
  has_table_privilege('authenticated', 'public.device_push_tokens', 'select'),
  'a signed-in seller can list their own devices');

-- ---------------------------------------------------------------------------
-- Fan-out: one push row per active device, scoped to the order's seller.
-- ---------------------------------------------------------------------------
insert into public.device_push_tokens (seller_account_id, auth_user_id, expo_push_token, platform, active)
values
  ('b1b10000-0000-4000-8000-000000000001','a1a10000-0000-4000-8000-000000000001',
   'ExponentPushToken[a-phone]','ios',true),
  ('b1b10000-0000-4000-8000-000000000001','a1a10000-0000-4000-8000-000000000001',
   'ExponentPushToken[a-tablet]','android',true),
  -- Signed out on this device: must not be notified.
  ('b1b10000-0000-4000-8000-000000000001','a1a10000-0000-4000-8000-000000000001',
   'ExponentPushToken[a-old]','ios',false),
  -- Another seller entirely.
  ('b1b10000-0000-4000-8000-000000000002','a1a10000-0000-4000-8000-000000000002',
   'ExponentPushToken[b-phone]','ios',true);

select lives_ok(
  $$select public.enqueue_order_notification('e1e10000-0000-4000-8000-000000000001','confirmed')$$,
  'enqueueing an order notification succeeds with devices registered');

select is(
  (select count(*)::int from public.notifications
    where order_id = 'e1e10000-0000-4000-8000-000000000001' and channel = 'push'),
  2,
  'one push per active device, and none for the inactive one');

select is(
  (select count(*)::int from public.notifications
    where order_id = 'e1e10000-0000-4000-8000-000000000001'
      and channel = 'push' and recipient = 'ExponentPushToken[b-phone]'),
  0,
  'another seller''s device is never notified');

select is(
  (select payload->>'orderId' from public.notifications
    where order_id = 'e1e10000-0000-4000-8000-000000000001'
      and channel = 'push' limit 1),
  'e1e10000-0000-4000-8000-000000000001',
  'the payload carries the order id so a tap can deep link');

-- The pre-existing channels must survive the function being replaced.
select is(
  (select count(*)::int from public.notifications
    where order_id = 'e1e10000-0000-4000-8000-000000000001' and channel = 'in_app'),
  1,
  'the seller in-app notification still fires');

select * from finish();

rollback;
