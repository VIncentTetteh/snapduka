-- The analytics RPCs are SECURITY INVOKER, which is the whole safety argument:
-- they read only tables the caller can already read, so RLS bounds them to the
-- caller's own shop. If either were ever redefined as SECURITY DEFINER, any
-- seller could read every other seller's revenue by calling it — so that is
-- asserted here rather than left to review.
--
-- The profit function also has to keep a null cost null. Coalescing it to zero
-- would report a 100% margin for any product whose cost has not been entered,
-- which is worse than reporting nothing.

begin;

set local search_path = extensions, public;

select plan(10);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('a2a20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'analytics@rpc.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('b2b20000-0000-4000-8000-000000000001', 'a2a20000-0000-4000-8000-000000000001',
        'GH', 'active', true, 'Analytics Seller');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('c2c20000-0000-4000-8000-000000000001', 'b2b20000-0000-4000-8000-000000000001',
        'analytics-shop', 'Analytics Shop', 'GH', 'GHS', 'published', now());

insert into public.customers (id, seller_account_id, name, email, phone, country)
values
  ('d2d20000-0000-4000-8000-000000000001', 'b2b20000-0000-4000-8000-000000000001',
   'Repeat Buyer', 'repeat@rpc.test', '+233201234567', 'GH'),
  ('d2d20000-0000-4000-8000-000000000002', 'b2b20000-0000-4000-8000-000000000001',
   'One Off', 'once@rpc.test', '+233201234568', 'GH');

insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor,
                             status, inventory_policy, stock_quantity, published_at)
values
  ('e2e20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'Costed', 'costed', 'GHS', 5000,
   'active', 'track', 10, now()),
  ('e2e20000-0000-4000-8000-000000000002', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'Uncosted', 'uncosted', 'GHS', 3000,
   'active', 'track', 10, now());

-- Two paid orders from one buyer (so they count as repeat) and one from another.
insert into public.orders (
  id, shop_id, seller_account_id, customer_id, currency, status, payment_status,
  fulfillment_status, payment_method, subtotal_minor, delivery_minor, total_minor,
  buyer_snapshot, fulfillment_method_snapshot, created_at)
values
  ('f2f20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000001',
   'GHS', 'completed', 'paid', 'fulfilled', 'paystack', 5000, 0, 5000,
   '{"name":"Repeat Buyer"}'::jsonb, '{"type":"delivery"}'::jsonb, now()),
  ('f2f20000-0000-4000-8000-000000000002', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000001',
   'GHS', 'completed', 'paid', 'fulfilled', 'paystack', 3000, 0, 3000,
   '{"name":"Repeat Buyer"}'::jsonb, '{"type":"delivery"}'::jsonb, now()),
  ('f2f20000-0000-4000-8000-000000000003', 'c2c20000-0000-4000-8000-000000000001',
   'b2b20000-0000-4000-8000-000000000001', 'd2d20000-0000-4000-8000-000000000002',
   'GHS', 'pending', 'unpaid', 'unconfirmed', 'cash_on_delivery', 1000, 0, 1000,
   '{"name":"One Off"}'::jsonb, '{"type":"pickup"}'::jsonb, now());

insert into public.order_lines (order_id, product_id, product_name, quantity,
                                unit_price_minor, unit_cost_minor, line_total_minor, snapshot)
values
  ('f2f20000-0000-4000-8000-000000000001', 'e2e20000-0000-4000-8000-000000000001',
   'Costed', 1, 5000, 2000, 5000, '{}'::jsonb),
  ('f2f20000-0000-4000-8000-000000000002', 'e2e20000-0000-4000-8000-000000000002',
   'Uncosted', 1, 3000, null, 3000, '{}'::jsonb),
  -- On an unpaid order, so it must not appear in profit at all.
  ('f2f20000-0000-4000-8000-000000000003', 'e2e20000-0000-4000-8000-000000000001',
   'Costed', 1, 1000, 2000, 1000, '{}'::jsonb);

-- analytics_events.id has no default; the storefront beacon supplies one.
insert into public.analytics_events (id, seller_account_id, shop_id, session_id, event_type)
values
  (gen_random_uuid(), 'b2b20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'visit'),
  (gen_random_uuid(), 'b2b20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000002', 'visit'),
  (gen_random_uuid(), 'b2b20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'product_view'),
  (gen_random_uuid(), 'b2b20000-0000-4000-8000-000000000001', 'c2c20000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'checkout_start');

-- ---------------------------------------------------------------------------
-- Exposure. The reason these can be SECURITY INVOKER at all.
-- ---------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'seller_analytics_summary'),
  false,
  'seller_analytics_summary is SECURITY INVOKER, so RLS bounds it to the caller');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'seller_product_profit'),
  false,
  'seller_product_profit is SECURITY INVOKER, so RLS bounds it to the caller');

select ok(
  not has_function_privilege('anon', 'public.seller_analytics_summary(timestamptz,timestamptz)', 'execute'),
  'anon cannot read a seller''s funnel');
select ok(
  not has_function_privilege('anon', 'public.seller_product_profit(timestamptz,timestamptz)', 'execute'),
  'anon cannot read a seller''s margins');
select ok(
  has_function_privilege('authenticated', 'public.seller_analytics_summary(timestamptz,timestamptz)', 'execute'),
  'a signed-in seller can read their own funnel');

-- ---------------------------------------------------------------------------
-- Arithmetic.
-- ---------------------------------------------------------------------------
select is(
  (select visits from public.seller_analytics_summary(now() - interval '1 day', now() + interval '1 day')),
  2::bigint,
  'visits are counted from analytics_events');

select is(
  (select paid_total_minor from public.seller_analytics_summary(now() - interval '1 day', now() + interval '1 day')),
  8000::bigint,
  'paid total counts only paid orders');

select is(
  (select repeat_buyers from public.seller_analytics_summary(now() - interval '1 day', now() + interval '1 day')),
  1::bigint,
  'a buyer with two paid orders counts once as a repeat buyer');

select is(
  (select profit_minor from public.seller_product_profit(now() - interval '1 day', now() + interval '1 day')
    where product_id = 'e2e20000-0000-4000-8000-000000000001'),
  3000::bigint,
  'profit uses the cost snapshotted on the line, and ignores unpaid orders');

-- The important one: a missing cost is not a cost of nothing.
select is(
  (select profit_minor from public.seller_product_profit(now() - interval '1 day', now() + interval '1 day')
    where product_id = 'e2e20000-0000-4000-8000-000000000002'),
  null,
  'a product with no cost reports null profit rather than 100% margin');

select * from finish();

rollback;
