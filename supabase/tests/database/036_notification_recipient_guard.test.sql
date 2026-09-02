-- enqueue_order_notification is the seller's only signal that an order moved,
-- and it fans out across several channels in one function. It used to insert
-- the buyer's email row straight from buyer_snapshot->>'email' with no guard;
-- notifications.recipient is NOT NULL, so an order whose snapshot carried no
-- email aborted the entire function and took the seller's own in_app row, every
-- push row and the seller email down with it.
--
-- These tests pin the property that matters: a missing optional recipient must
-- cost exactly its own channel and nothing else.

begin;

set local search_path = extensions, public;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a2a20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'guard@notify.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email)
values ('b2b20000-0000-4000-8000-000000000001', 'a2a20000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Guard Seller', 'guard-seller@notify.test');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c2c20000-0000-4000-8000-000000000001', 'b2b20000-0000-4000-8000-000000000001',
        'guard-shop', 'Guard Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('d2d20000-0000-4000-8000-000000000001', 'b2b20000-0000-4000-8000-000000000001',
        'Guard Buyer', 'guard-buyer@notify.test', '+233201234567', 'GH');

-- Order 1: no email in the snapshot at all.
-- Order 2: an email present but blank, which is the same failure with a
--          different shape and would have passed a naive `is not null` guard.
-- Order 3: a well-formed snapshot, to prove the guard didn't cost the happy path.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values
  ('e2e20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000001',
   'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 10000, 0, 10000,
   '{"name":"Guard Buyer","phone":"+233201234567"}'::jsonb, '{"type":"delivery"}'::jsonb),
  ('e2e20000-0000-4000-8000-000000000002', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000001',
   'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 10000, 0, 10000,
   '{"name":"Guard Buyer","email":"   "}'::jsonb, '{"type":"delivery"}'::jsonb),
  ('e2e20000-0000-4000-8000-000000000003', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000001',
   'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 10000, 0, 10000,
   '{"name":"Guard Buyer","email":"guard-buyer@notify.test"}'::jsonb, '{"type":"delivery"}'::jsonb);

-- ---------------------------------------------------------------------------
-- A snapshot with no email must not abort the function.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.enqueue_order_notification('e2e20000-0000-4000-8000-000000000001','confirmed')$$,
  'a buyer_snapshot without an email does not raise');

select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000001' and channel = 'email'
     and template = 'order_update'),
  0, 'no buyer email row is enqueued when the snapshot has no email');

select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000001' and channel = 'in_app'),
  1, 'the seller still gets their in_app row');

select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000001'
     and channel = 'email' and template = 'seller_order_update'),
  1, 'the seller still gets their own email');

-- ---------------------------------------------------------------------------
-- Whitespace is not an address.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.enqueue_order_notification('e2e20000-0000-4000-8000-000000000002','confirmed')$$,
  'a blank email in the snapshot does not raise');

select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000002' and channel = 'email'
     and template = 'order_update'),
  0, 'a whitespace-only email enqueues no buyer row');

-- ---------------------------------------------------------------------------
-- The happy path is unchanged.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000003' and channel = 'email'
     and template = 'order_update' and recipient = 'guard-buyer@notify.test'),
  0, 'no buyer row exists before the function runs');

select public.enqueue_order_notification('e2e20000-0000-4000-8000-000000000003','confirmed');

select is(
  (select count(*)::int from public.notifications
   where order_id = 'e2e20000-0000-4000-8000-000000000003' and channel = 'email'
     and template = 'order_update' and recipient = 'guard-buyer@notify.test'),
  1, 'a present buyer email still enqueues exactly one buyer row');

select * from finish();
rollback;
