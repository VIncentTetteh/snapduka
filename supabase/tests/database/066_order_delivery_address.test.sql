-- orders.delivery_address (202609250142): derived from buyer_snapshot at
-- insert, never trusted, and never able to cost the seller an order.

begin;

set local search_path = extensions, public;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('66660000-0000-4000-8000-0000000c0001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'address@test', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('66660000-0000-4000-8000-0000000c00a1', '66660000-0000-4000-8000-0000000c0001',
        'GH', 'active', true, 'Address Seller');
insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('66660000-0000-4000-8000-0000000c00b1', '66660000-0000-4000-8000-0000000c00a1',
        'address-shop', 'Address Shop', 'GH', 'GHS', 'published', now());
insert into public.products (id, shop_id, seller_account_id, name, slug, currency,
                             price_minor, status, published_at, stock_quantity)
values ('66660000-0000-4000-8000-0000000c00c1', '66660000-0000-4000-8000-0000000c00b1',
        '66660000-0000-4000-8000-0000000c00a1', 'Shea butter', 'shea', 'GHS', 1000, 'active', now(), 10);
insert into public.fulfillment_methods (id, shop_id, seller_account_id, type, name, fee_minor)
values ('66660000-0000-4000-8000-0000000c00d1', '66660000-0000-4000-8000-0000000c00b1',
        '66660000-0000-4000-8000-0000000c00a1', 'delivery', 'Accra delivery', 500);

-- ── the normaliser ──────────────────────────────────────────────────────────
select is(
  public.normalize_delivery_address(
    '{"line1":" 4 Palm St ","area":"Labone","city":"Accra","region":"Greater Accra","digitalAddress":"ga 123 4567","landmark":"Opposite Total","lat":5.603712345,"lng":-0.18}'::jsonb,
    'GH') ->> 'digitalAddress',
  'GA-123-4567', 'a GhanaPostGPS code is stored in canonical form');
select is(
  (public.normalize_delivery_address('{"city":"Accra","lat":5.603712345,"lng":-0.18}'::jsonb, 'GH') ->> 'lat')::numeric,
  5.603712, 'coordinates are rounded to six places');
select is(
  public.normalize_delivery_address('{"city":"Accra","digitalAddress":"OA-123-4567"}'::jsonb, 'GH') -> 'digitalAddress',
  'null'::jsonb, 'a code with an unknown region letter is dropped');
select is(
  public.normalize_delivery_address('{"city":"Lagos","digitalAddress":"GA-123-4567"}'::jsonb, 'NG') -> 'digitalAddress',
  'null'::jsonb, 'GhanaPostGPS is Ghana only');
select is(
  public.normalize_delivery_address('{"city":"Accra","lat":5.6}'::jsonb, 'GH') ->> 'geoSource',
  'none', 'half a pin is no pin');
select is(
  public.normalize_delivery_address('{"city":"Accra","lat":95,"lng":0}'::jsonb, 'GH') -> 'lat',
  'null'::jsonb, 'a pin off the planet is dropped');
select is(
  public.normalize_delivery_address('{"city":"Accra","lat":"5.6","lng":"-0.1"}'::jsonb, 'GH') -> 'lat',
  'null'::jsonb, 'coordinates must be numbers, not strings');
select is(
  length(public.normalize_delivery_address(jsonb_build_object('city', repeat('x', 500)), 'GH') ->> 'city'),
  100, 'strings are bounded');
select is(public.normalize_delivery_address('"a string"'::jsonb, 'GH'), null::jsonb,
  'a non-object address yields nothing');
select is(public.normalize_delivery_address('{}'::jsonb, 'GH'), null::jsonb,
  'an empty address yields nothing');

-- ── a real storefront order ─────────────────────────────────────────────────
create temp table placed as
select public.create_guest_order_growth(
  '66660000-0000-4000-8000-0000000c00b1',
  '66660000-0000-4000-8000-0000000c00d1',
  '{"name":"Ama Mensah","email":"ama@address.test","phone":"+233201234567","country":"GH",
    "address":{"line1":"4 Palm St","area":"Labone","city":"Accra","region":"Greater Accra",
               "digitalAddress":"ga-123-4567","landmark":"Blue gate","lat":5.6037,"lng":-0.1870}}'::jsonb,
  '[{"productId":"66660000-0000-4000-8000-0000000c00c1","quantity":2}]'::jsonb,
  'address-test-idem-1',
  'cash_on_delivery'
) as result;

select is(
  (select delivery_address ->> 'digitalAddress' from public.orders
    where id = ((select result from placed) ->> 'orderId')::uuid),
  'GA-123-4567', 'a storefront order carries the normalised address');
select is(
  (select delivery_address ->> 'landmark' from public.orders
    where id = ((select result from placed) ->> 'orderId')::uuid),
  'Blue gate', 'and the landmark');
-- Totals come from the RPC alone: 2 x 1000 + 500 delivery.
select is(
  (select total_minor from public.orders where id = ((select result from placed) ->> 'orderId')::uuid),
  2500::bigint, 'the address capture does not touch totals');

-- An order with no address at all (pickup, or a legacy caller) still lands.
insert into public.customers (id, seller_account_id, name, email, phone, country)
values ('66660000-0000-4000-8000-0000000c00e1', '66660000-0000-4000-8000-0000000c00a1',
        'Kojo', 'kojo@address.test', '+233201234599', 'GH');
insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, payment_method,
  subtotal_minor, delivery_minor, total_minor, buyer_snapshot, fulfillment_method_snapshot)
values ('66660000-0000-4000-8000-0000000c00f1', '66660000-0000-4000-8000-0000000c00b1',
        '66660000-0000-4000-8000-0000000c00a1', '66660000-0000-4000-8000-0000000c00e1',
        'GHS', 'pay_on_pickup', 1000, 0, 1000,
        '{"country":"ZZ","address":{"lat":"junk"}}'::jsonb, '{"type":"pickup"}'::jsonb);
select is(
  (select delivery_address from public.orders where id = '66660000-0000-4000-8000-0000000c00f1'),
  null::jsonb, 'an order with junk for an address is still placed, with no delivery address');

select * from finish();
rollback;
