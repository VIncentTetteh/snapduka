-- Server-side funnel events (202609250241): each fact lands exactly once, in
-- the same transaction as the fact, with no contact details — and the rows
-- are asserted to LAND, because the triggers swallow their own failures.

begin;

set local search_path = extensions, public;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'funnel-seller@example.com', now(), now()),
       ('09100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'shopless-seller@example.com', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name,
                                    contact_email, contact_phone)
values ('09100000-0000-4000-8000-0000000000a1', '09100000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Funnel Seller', 'funnel-seller@example.com', '+233241119101'),
       ('09100000-0000-4000-8000-0000000000a2', '09100000-0000-4000-8000-000000000002',
        'GH', 'active', true, 'Shopless Seller', 'shopless-seller@example.com', '+233241119102');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('09100000-0000-4000-8000-0000000000b1', '09100000-0000-4000-8000-0000000000a1',
        'funnel-shop', 'Funnel Shop', 'Funnel Shop Ltd', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('09100000-0000-4000-8000-0000000000c1', '09100000-0000-4000-8000-0000000000a1',
        'Efua Buyer', 'efua@example.com', '+233241119103', 'GH');

create or replace function pg_temp.events(p_type text, p_subject uuid) returns int language sql as $$
  select count(*)::int from public.analytics_events where event_type = p_type and session_id = p_subject;
$$;

-- ---------------------------------------------------------------------------
-- checkout_completed
-- ---------------------------------------------------------------------------
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
                           delivery_minor, total_minor, payment_method, fulfillment_method_snapshot,
                           buyer_snapshot)
values ('09100000-0000-4000-8000-0000000000d1', '09100000-0000-4000-8000-0000000000b1',
        '09100000-0000-4000-8000-0000000000a1', '09100000-0000-4000-8000-0000000000c1', 'GHS',
        5000, 0, 5000, 'paystack', '{}'::jsonb,
        '{"name":"Efua","phone":"+233241119103","email":"efua@example.com"}'::jsonb);

select is(pg_temp.events('checkout_completed', '09100000-0000-4000-8000-0000000000d1'), 1,
  'placing an order records checkout_completed');
select is(
  (select id from public.analytics_events where event_type = 'checkout_completed'
      and session_id = '09100000-0000-4000-8000-0000000000d1'),
  md5('checkout_completed:09100000-0000-4000-8000-0000000000d1')::uuid,
  'the event id is derived from (type, order), which is what makes it idempotent');
select is(
  (select dimensions from public.analytics_events where event_type = 'checkout_completed'
      and session_id = '09100000-0000-4000-8000-0000000000d1'),
  '{"origin":"server","currency":"GHS","payment_method":"paystack","protection_mode":"none"}'::jsonb,
  'dimensions carry enums only — nothing from buyer_snapshot');
select is(
  (select shop_id from public.analytics_events where event_type = 'checkout_completed'
      and session_id = '09100000-0000-4000-8000-0000000000d1'),
  '09100000-0000-4000-8000-0000000000b1'::uuid, 'attributed to the order''s shop');
select is(pg_temp.events('protect_opted_in', '09100000-0000-4000-8000-0000000000d1'), 0,
  'an unprotected order records no protect_opted_in');

-- ---------------------------------------------------------------------------
-- protect_opted_in: on the change to 'protect', once, however often toggled.
-- ---------------------------------------------------------------------------
update public.orders set protection_mode = 'protect' where id = '09100000-0000-4000-8000-0000000000d1';
select is(pg_temp.events('protect_opted_in', '09100000-0000-4000-8000-0000000000d1'), 1,
  'opting into Protect records protect_opted_in');
update public.orders set protection_mode = 'none' where id = '09100000-0000-4000-8000-0000000000d1';
update public.orders set protection_mode = 'protect' where id = '09100000-0000-4000-8000-0000000000d1';
select is(pg_temp.events('protect_opted_in', '09100000-0000-4000-8000-0000000000d1'), 1,
  'toggling off and on again does not double count');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor,
                           delivery_minor, total_minor, payment_method, fulfillment_method_snapshot,
                           buyer_snapshot, protection_mode)
values ('09100000-0000-4000-8000-0000000000d2', '09100000-0000-4000-8000-0000000000b1',
        '09100000-0000-4000-8000-0000000000a1', '09100000-0000-4000-8000-0000000000c1', 'GHS',
        5000, 0, 5000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'protect');
select is(pg_temp.events('protect_opted_in', '09100000-0000-4000-8000-0000000000d2'), 1,
  'an order placed already protected records protect_opted_in');

-- ---------------------------------------------------------------------------
-- delivery_confirmed (the protect.delivered outbox handler's call)
-- ---------------------------------------------------------------------------
select isnt(public.record_order_analytics_event('delivery_confirmed', '09100000-0000-4000-8000-0000000000d1',
  '{"method":"buyer_code"}'::jsonb), null, 'delivery_confirmed is recorded for the order');
select lives_ok($$
  select public.record_order_analytics_event('delivery_confirmed', '09100000-0000-4000-8000-0000000000d1',
    '{"method":"buyer_code"}'::jsonb)
$$, 'a redelivered outbox event is harmless');
select is(pg_temp.events('delivery_confirmed', '09100000-0000-4000-8000-0000000000d1'), 1,
  'and still records one row');
select throws_ok($$
  select public.record_order_analytics_event('delivery_confirmed', gen_random_uuid())
$$, 'P0002', null, 'an unknown order is an error the outbox can see');

-- ---------------------------------------------------------------------------
-- payout_instant_requested
-- ---------------------------------------------------------------------------
insert into public.payout_requests (id, seller_account_id, amount_minor, currency, speed)
values ('09100000-0000-4000-8000-0000000000e1', '09100000-0000-4000-8000-0000000000a1', 1000, 'GHS', 'instant'),
       ('09100000-0000-4000-8000-0000000000e2', '09100000-0000-4000-8000-0000000000a1', 1000, 'GHS', 'standard');
select is(pg_temp.events('payout_instant_requested', '09100000-0000-4000-8000-0000000000e1'), 1,
  'an instant payout request is recorded');
select is(pg_temp.events('payout_instant_requested', '09100000-0000-4000-8000-0000000000e2'), 0,
  'a standard payout request is not');

-- A seller with no shop has no funnel: nothing recorded, and the payout
-- itself is untouched.
select lives_ok($$
  insert into public.payout_requests (id, seller_account_id, amount_minor, currency, speed)
  values ('09100000-0000-4000-8000-0000000000e3', '09100000-0000-4000-8000-0000000000a2', 1000, 'GHS', 'instant')
$$, 'a shopless seller''s instant payout still succeeds');
select is(pg_temp.events('payout_instant_requested', '09100000-0000-4000-8000-0000000000e3'), 0,
  'and records no event');

-- ---------------------------------------------------------------------------
-- wa_conversation_started: only once bound to a seller.
-- ---------------------------------------------------------------------------
insert into public.wa_conversations (id, buyer_phone)
values ('09100000-0000-4000-8000-0000000000f1', '+233241119104');
select is(pg_temp.events('wa_conversation_started', '09100000-0000-4000-8000-0000000000f1'), 0,
  'an unbound conversation has no shop to attribute it to');
update public.wa_conversations set seller_account_id = '09100000-0000-4000-8000-0000000000a1'
 where id = '09100000-0000-4000-8000-0000000000f1';
select is(pg_temp.events('wa_conversation_started', '09100000-0000-4000-8000-0000000000f1'), 1,
  'binding it to a seller records wa_conversation_started');
select ok(
  (select dimensions::text not like '%233241119104%' from public.analytics_events
    where event_type = 'wa_conversation_started' and session_id = '09100000-0000-4000-8000-0000000000f1'),
  'the buyer''s phone is not in the event');

-- ---------------------------------------------------------------------------
-- The public ingestion types cannot be written through the server path, and
-- only service_role may call it.
-- ---------------------------------------------------------------------------
select throws_ok($$
  select public.record_server_analytics_event('visit', '09100000-0000-4000-8000-0000000000a1', gen_random_uuid())
$$, '22023', null, 'client event types are refused by the server writer');
select ok(not has_function_privilege('authenticated',
  'public.record_server_analytics_event(text, uuid, uuid, uuid, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('anon',
  'public.record_order_analytics_event(text, uuid, jsonb)', 'execute'),
  'no browser role can record a server event');

select is((select count(*)::int from public.check_ledger_invariants()), 0, 'ledger invariants hold');

select * from finish();
rollback;
