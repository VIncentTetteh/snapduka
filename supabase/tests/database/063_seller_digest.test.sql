-- Seller digest selection and summary, and SMS broadcasts (202609250123).

begin;

set local search_path = extensions, public;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('63600000-0000-4000-8000-00000000000' || g)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'digest' || g || '@test.test', now(), now()
  from generate_series(1, 5) g;

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_phone)
values
  -- 1: daily by default (no preferences row)
  ('63610000-0000-4000-8000-000000000001', '63600000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Daily', '+233201000001'),
  -- 2: weekly
  ('63610000-0000-4000-8000-000000000002', '63600000-0000-4000-8000-000000000002', 'GH', 'active', true, 'Weekly', '+233201000002'),
  -- 3: off
  ('63610000-0000-4000-8000-000000000003', '63600000-0000-4000-8000-000000000003', 'GH', 'active', true, 'Off', '+233201000003'),
  -- 4: daily but no phone
  ('63610000-0000-4000-8000-000000000004', '63600000-0000-4000-8000-000000000004', 'GH', 'active', true, 'No phone', null),
  -- 5: suspended
  ('63610000-0000-4000-8000-000000000005', '63600000-0000-4000-8000-000000000005', 'GH', 'suspended', false, 'Suspended', '+233201000005');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
select ('63620000-0000-4000-8000-00000000000' || g)::uuid, ('63610000-0000-4000-8000-00000000000' || g)::uuid,
       'digest-shop-' || g, 'Digest Shop ' || g, 'GH', 'GHS', 'published', now()
  from generate_series(1, 5) g;

insert into public.notification_preferences (seller_account_id, digest_frequency)
values ('63610000-0000-4000-8000-000000000002', 'weekly'), ('63610000-0000-4000-8000-000000000003', 'off');

select ok(not has_table_privilege('authenticated', 'public.seller_digests', 'select'), 'digests are service-role only');
select ok(not has_function_privilege('authenticated', 'public.seller_digest_summary(uuid,timestamptz,timestamptz)', 'execute'),
  'the summary is not an authenticated RPC');

select set_eq(
  $$select seller_account_id from public.seller_digest_due('daily', current_date)
     where seller_account_id::text like '6361%'$$,
  $$values ('63610000-0000-4000-8000-000000000001'::uuid)$$,
  'daily: the default-daily seller with a phone, not off / weekly / phoneless / suspended');
select set_eq(
  $$select seller_account_id from public.seller_digest_due('weekly', current_date)
     where seller_account_id::text like '6361%'$$,
  $$values ('63610000-0000-4000-8000-000000000002'::uuid)$$,
  'weekly: only the weekly seller');

insert into public.seller_digests (seller_account_id, period_start, frequency, channel, status)
values ('63610000-0000-4000-8000-000000000001', current_date, 'daily', 'sms', 'sent');
select is(
  (select count(*)::int from public.seller_digest_due('daily', current_date) where seller_account_id::text like '6361%'),
  0, 'a seller already sent this period is not due again');
select is(
  (select count(*)::int from public.seller_digest_due('daily', current_date + 1) where seller_account_id::text like '6361%'),
  1, 'but is due the next day');
select throws_ok(
  $$insert into public.seller_digests (seller_account_id, period_start, frequency, status)
    values ('63610000-0000-4000-8000-000000000001', current_date, 'daily', 'sent')$$,
  '23505', null, 'one digest per seller per period');

-- Summary
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('63630000-0000-4000-8000-000000000001', '63610000-0000-4000-8000-000000000001', 'Buyer', 'b@test.test', '+233209000001', 'GH');
insert into public.orders (shop_id, seller_account_id, customer_id, status, payment_status, fulfillment_status, currency,
                           subtotal_minor, delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot, created_at)
values
  ('63620000-0000-4000-8000-000000000001', '63610000-0000-4000-8000-000000000001', '63630000-0000-4000-8000-000000000001',
   'confirmed', 'paid', 'unconfirmed', 'GHS', 10000, 0, 10000, 'paystack', '{}', '{}', now() - interval '2 hours'),
  ('63620000-0000-4000-8000-000000000001', '63610000-0000-4000-8000-000000000001', '63630000-0000-4000-8000-000000000001',
   'pending', 'unpaid', 'unconfirmed', 'GHS', 5000, 0, 5000, 'cash_on_delivery', '{}', '{}', now() - interval '3 hours'),
  ('63620000-0000-4000-8000-000000000001', '63610000-0000-4000-8000-000000000001', '63630000-0000-4000-8000-000000000001',
   'cancelled', 'unpaid', 'cancelled', 'GHS', 7000, 0, 7000, 'paystack', '{}', '{}', now() - interval '4 hours'),
  -- outside the window
  ('63620000-0000-4000-8000-000000000001', '63610000-0000-4000-8000-000000000001', '63630000-0000-4000-8000-000000000001',
   'confirmed', 'paid', 'dispatched', 'GHS', 99900, 0, 99900, 'paystack', '{}', '{}', now() - interval '3 days');
insert into public.wa_conversations (buyer_phone, seller_account_id, unread_count)
values ('+233209000001', '63610000-0000-4000-8000-000000000001', 3);

select is((select orders_count from public.seller_digest_summary('63610000-0000-4000-8000-000000000001', now() - interval '1 day', now())),
  2, 'orders in the window, cancelled excluded');
select is((select paid_revenue_minor from public.seller_digest_summary('63610000-0000-4000-8000-000000000001', now() - interval '1 day', now())),
  10000::bigint, 'paid revenue in the window only');
select is((select to_fulfil from public.seller_digest_summary('63610000-0000-4000-8000-000000000001', now() - interval '1 day', now())),
  1, 'confirmed and not yet dispatched is to fulfil; dispatched is not');
select is((select unread_conversations from public.seller_digest_summary('63610000-0000-4000-8000-000000000001', now() - interval '1 day', now())),
  1, 'unread conversations are counted');

-- Broadcast channel and schedule
select lives_ok(
  $$insert into public.marketing_broadcasts (seller_account_id, channel, body) values ('63610000-0000-4000-8000-000000000001', 'sms', 'Sale!')$$,
  'sms is a broadcast channel');
select throws_ok(
  $$insert into public.marketing_broadcasts (seller_account_id, channel, body) values ('63610000-0000-4000-8000-000000000001', 'fax', 'x')$$,
  '23514', null, 'other channels are still refused');
select is((select count(*)::int from cron.job where jobname = 'snapduka-seller-digest'), 1, 'the digest is scheduled');

select * from finish();
rollback;
