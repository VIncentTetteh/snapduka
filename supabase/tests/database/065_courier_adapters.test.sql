-- Courier adapters (202609250140): the quote cache, adapter bookings, and
-- partner credentials that must only ever exist in Vault.

begin;

set local search_path = extensions, public;

select plan(17);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('65650000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'courier-a@test', now(), now()),
       ('65650000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'courier-b@test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('65650000-0000-4000-8000-0000000000a1', '65650000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Courier Seller A'),
       ('65650000-0000-4000-8000-0000000000a2', '65650000-0000-4000-8000-000000000002',
        'GH', 'active', true, 'Courier Seller B');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency)
values ('65650000-0000-4000-8000-0000000000b1', '65650000-0000-4000-8000-0000000000a1',
        'courier-shop-a', 'Courier Shop A', 'GH', 'GHS'),
       ('65650000-0000-4000-8000-0000000000b2', '65650000-0000-4000-8000-0000000000a2',
        'courier-shop-b', 'Courier Shop B', 'GH', 'GHS');

-- ── margin ──────────────────────────────────────────────────────────────────
select is((select delivery_margin_bps from public.country_configs where country = 'GH'), 0,
  'the delivery margin defaults to pass-through');
select throws_ok($$update public.country_configs set delivery_margin_bps = 5001 where country = 'GH'$$,
  '23514', null, 'a margin above 50% is refused');

-- ── quote cache ─────────────────────────────────────────────────────────────
select lives_ok($$insert into public.courier_quotes
    (seller_account_id, shop_id, provider, service, amount_minor, margin_minor, currency, expires_at, cache_key)
  values ('65650000-0000-4000-8000-0000000000a1', '65650000-0000-4000-8000-0000000000b1',
          'sandbox', 'standard', 1500, 150, 'GHS', now() + interval '15 minutes', repeat('a', 64))$$,
  'a storefront quote needs no order');
select throws_ok($$insert into public.courier_quotes
    (seller_account_id, shop_id, provider, service, amount_minor, currency, expires_at)
  values ('65650000-0000-4000-8000-0000000000a1', '65650000-0000-4000-8000-0000000000b2',
          'sandbox', 'standard', 1500, 'GHS', now())$$,
  '23503', null, 'a quote cannot name another seller''s shop');
select throws_ok($$insert into public.courier_quotes
    (seller_account_id, provider, service, amount_minor, currency, expires_at)
  values ('65650000-0000-4000-8000-0000000000a1', 'sandbox', 'standard', 1500, 'GHS', now())$$,
  '23514', null, 'a quote belongs to an order or a shop');
select throws_ok($$insert into public.courier_quotes
    (seller_account_id, shop_id, provider, service, amount_minor, currency, expires_at, cache_key)
  values ('65650000-0000-4000-8000-0000000000a1', '65650000-0000-4000-8000-0000000000b1',
          'sandbox', 'standard', 1500, 'GHS', now(), 'not-a-hash')$$,
  '23514', null, 'the cache key is a sha256 hex digest');
select ok(not has_table_privilege('authenticated', 'public.courier_quotes', 'insert'),
  'sellers cannot plant quotes on their own storefront');

-- ── shipments ───────────────────────────────────────────────────────────────
select ok(
  (select pg_get_constraintdef(oid) like '%sandbox%' from pg_constraint
    where conname = 'shipments_provider_check'),
  'the sandbox courier is an accepted shipment provider');
select ok(
  (select pg_get_constraintdef(oid) like '%bolt%' and pg_get_constraintdef(oid) like '%manual%'
     from pg_constraint where conname = 'shipments_provider_check'),
  'every catalogue courier is still accepted');
select ok(exists(select 1 from pg_indexes where indexname = 'shipments_provider_booking_key'),
  'a partner booking id identifies one shipment');

-- ── credentials ─────────────────────────────────────────────────────────────
select hasnt_column('public', 'courier_connections', 'credentials_encrypted',
  'the misnamed plaintext credentials column is gone');

select lives_ok($$select public.set_courier_connection_credentials(
    '65650000-0000-4000-8000-0000000000a1', 'yango', '{"apiKey":"k-1"}'::jsonb)$$,
  'credentials can be stored');
select is(
  public.courier_connection_credentials('65650000-0000-4000-8000-0000000000a1', 'yango'),
  '{"apiKey":"k-1"}'::jsonb, 'and read back by the server');

select public.set_courier_connection_credentials(
  '65650000-0000-4000-8000-0000000000a1', 'yango', '{"apiKey":"k-2"}'::jsonb);
select is(
  (select count(*)::int from vault.secrets s
     join public.courier_connections c on c.credentials_secret_id = s.id
    where c.seller_account_id = '65650000-0000-4000-8000-0000000000a1'),
  1, 'rotating credentials updates the secret rather than orphaning a new one');

update public.courier_connections set active = false
 where seller_account_id = '65650000-0000-4000-8000-0000000000a1';
select is(
  public.courier_connection_credentials('65650000-0000-4000-8000-0000000000a1', 'yango'),
  null::jsonb, 'an inactive connection yields no credentials');

select ok(not has_function_privilege('authenticated',
  'public.courier_connection_credentials(uuid,text)', 'execute'),
  'no client can read courier credentials');
select ok(not has_column_privilege('authenticated', 'public.courier_connections',
  'credentials_secret_id', 'update'),
  'a seller cannot point their connection at an arbitrary vault secret');

select * from finish();
rollback;
