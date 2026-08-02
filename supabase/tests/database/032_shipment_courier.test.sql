-- The courier a seller records is shown to the buyer, so the database has to
-- refuse anything that would render as nonsense or as nothing at all.
--
-- shipments.provider was unconstrained free text from 202606130018 until
-- 202608020066, and in practice always the literal 'manual'.

begin;

set local search_path = extensions, public;

select plan(11);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('cccc0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'courier@shipment.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('dddd0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Courier Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('eeee0000-0000-4000-8000-000000000001', 'dddd0000-0000-4000-8000-000000000001',
        'courier-shop', 'Courier Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('ffff0000-0000-4000-8000-000000000001', 'dddd0000-0000-4000-8000-000000000001',
        'Buyer', 'buyer@shipment.test', '+233201234567', 'GH');

insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot)
values (
  '10100000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
  'dddd0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001',
  'GHS', 'confirmed', 'paid', 'confirmed', 'paystack', 10000, 0, 10000,
  '{"name":"Buyer"}'::jsonb, '{"type":"delivery"}'::jsonb);

select has_column('public', 'shipments', 'provider_name',
  'shipments carry the label the buyer is shown');

-- ---------------------------------------------------------------------------
-- provider is constrained to the catalogue in src/lib/couriers/catalogue.ts.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.shipments (order_id, seller_account_id, provider, provider_name, tracking_number)
    values ('10100000-0000-4000-8000-000000000001','dddd0000-0000-4000-8000-000000000001',
            'bolt','Bolt','RIDER-1')$$,
  'a catalogue courier is accepted');

select throws_ok(
  $$insert into public.shipments (order_id, seller_account_id, provider, tracking_number)
    values (gen_random_uuid(),'dddd0000-0000-4000-8000-000000000001','definitely-not-real','R2')$$,
  '23514', null,
  'a courier outside the catalogue is rejected');

-- Legacy rows must keep working: everything booked before the picker existed
-- has provider = 'manual'.
select lives_ok(
  $$update public.shipments set provider = 'manual', provider_name = null
     where order_id = '10100000-0000-4000-8000-000000000001'$$,
  'the legacy manual provider is still valid');

-- ---------------------------------------------------------------------------
-- 'other' means "a courier we do not list", which tells the buyer nothing
-- without a name.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.shipments set provider = 'other', provider_name = null
     where order_id = '10100000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'other with no name is rejected');

select throws_ok(
  $$update public.shipments set provider = 'other', provider_name = '   '
     where order_id = '10100000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'other with a blank name is rejected');

select lives_ok(
  $$update public.shipments set provider = 'other', provider_name = 'Kwame Express'
     where order_id = '10100000-0000-4000-8000-000000000001'$$,
  'other with a name is accepted');

-- ---------------------------------------------------------------------------
-- updated_at. shipments never had the trigger every other mutable table has,
-- so it was frozen at insert forever — and rows are now editable.
-- ---------------------------------------------------------------------------
select has_trigger('public', 'shipments', 'shipments_set_updated_at',
  'shipments stamp updated_at on change');

select ok(
  (select updated_at > created_at from public.shipments
    where order_id = '10100000-0000-4000-8000-000000000001'),
  'correcting a delivery moves updated_at');

-- ---------------------------------------------------------------------------
-- One shipment per order: the book route relies on this for its upsert, which
-- is what makes correcting a mistyped tracking number possible.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.shipments (order_id, seller_account_id, provider, provider_name, tracking_number)
    values ('10100000-0000-4000-8000-000000000001','dddd0000-0000-4000-8000-000000000001',
            'yango','Yango','RIDER-DUP')$$,
  '23505', null,
  'a second shipment for the same order is rejected');

-- Staff whose whole job is fulfilment could not read the deliveries they
-- arrange: 202606130017_teams.sql gave fulfillment_methods team policies and
-- skipped shipments entirely.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'shipments'
      and policyname = 'shipments_team_read'),
  1,
  'fulfilment staff can read shipments');

select * from finish();
rollback;
