-- AI spend accounting and the SQL price suggestion (202609250120).

begin;

set local search_path = extensions, public;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('60600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-a@runs.test', now(), now()),
  ('60600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-b@runs.test', now(), now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values
  ('60610000-0000-4000-8000-000000000001', '60600000-0000-4000-8000-000000000001', 'GH', 'active', true, 'AI Seller A'),
  ('60610000-0000-4000-8000-000000000002', '60600000-0000-4000-8000-000000000002', 'NG', 'active', true, 'AI Seller B');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values
  ('60620000-0000-4000-8000-000000000001', '60610000-0000-4000-8000-000000000001',
   'ai-shop-a', 'AI Shop A', 'GH', 'GHS', 'published', now()),
  ('60620000-0000-4000-8000-000000000002', '60610000-0000-4000-8000-000000000002',
   'ai-shop-b', 'AI Shop B', 'NG', 'NGN', 'published', now());

insert into public.categories (id, name, slug)
values ('60630000-0000-4000-8000-000000000001', 'Test Skincare', 'test-skincare-060');

-- ---------------------------------------------------------------------------
-- Exposure
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.ai_runs', 'select'),
  'sellers cannot read ai_runs directly');
select ok(not has_table_privilege('anon', 'public.ai_runs', 'insert'),
  'anon cannot write ai_runs');
select ok(not has_function_privilege('authenticated', 'public.ai_spend_this_month(uuid)', 'execute'),
  'spend is not an authenticated RPC');
select ok(not has_function_privilege('authenticated', 'public.suggest_price(uuid, public.country_code)', 'execute'),
  'suggest_price reads every seller''s prices, so it is not an authenticated RPC');
select ok(has_function_privilege('service_role', 'public.suggest_price(uuid, public.country_code)', 'execute'),
  'the server can suggest prices');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_runs'::regclass), true,
  'ai_runs forces RLS');

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------
insert into public.ai_runs (seller_account_id, purpose, model, input_tokens, output_tokens, cost_usd_micros, outcome, created_at)
values
  ('60610000-0000-4000-8000-000000000001', 'listing_draft', 'claude-sonnet-5', 1000, 200, 4000, 'ok', now()),
  ('60610000-0000-4000-8000-000000000001', 'wa.agent', 'claude-sonnet-5', 1000, 200, 6000, 'ok', now()),
  -- Last month's spend is not this month's.
  ('60610000-0000-4000-8000-000000000001', 'wa.agent', 'claude-sonnet-5', 1000, 200, 900000,
   'ok', date_trunc('month', now()) - interval '1 day'),
  -- Another seller's spend is not this seller's.
  ('60610000-0000-4000-8000-000000000002', 'wa.agent', 'claude-sonnet-5', 1000, 200, 777, 'ok', now());

select is(public.ai_spend_this_month('60610000-0000-4000-8000-000000000001'), 10000::bigint,
  'spend sums this month''s runs for this seller only');
select is(public.ai_spend_this_month('60610000-0000-4000-8000-000000000009'), 0::bigint,
  'a seller with no runs has spent nothing, not null');

select throws_ok(
  $$insert into public.ai_runs (purpose, model, outcome, cost_usd_micros) values ('x.y', 'm', 'ok', -1)$$,
  '23514', null, 'cost cannot be negative');
select throws_ok(
  $$insert into public.ai_runs (purpose, model, outcome) values ('listing_draft', 'm', 'maybe')$$,
  '23514', null, 'outcome is a closed set');

-- ---------------------------------------------------------------------------
-- suggest_price
-- ---------------------------------------------------------------------------
-- Four products: below the threshold, so the size is reported and the
-- percentiles are withheld.
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status,
                             inventory_policy, stock_quantity, published_at)
select ('60640000-0000-4000-8000-00000000000' || g)::uuid,
       '60620000-0000-4000-8000-000000000001', '60610000-0000-4000-8000-000000000001',
       'Butter ' || g, 'butter-' || g, 'GHS', g * 1000, 'active', 'track', 5, now()
  from generate_series(1, 4) g;
insert into public.product_categories (product_id, category_id)
select ('60640000-0000-4000-8000-00000000000' || g)::uuid, '60630000-0000-4000-8000-000000000001'
  from generate_series(1, 4) g;

select is((select sample_size from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), 4,
  'a thin category reports its sample size');
select is((select median_minor from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), null,
  'and withholds percentiles rather than calling four listings a market');

-- A fifth active product, plus noise that must not count.
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status,
                             inventory_policy, stock_quantity, published_at)
values
  ('60640000-0000-4000-8000-000000000005', '60620000-0000-4000-8000-000000000001',
   '60610000-0000-4000-8000-000000000001', 'Butter 5', 'butter-5', 'GHS', 5000, 'active', 'track', 5, now()),
  ('60640000-0000-4000-8000-000000000006', '60620000-0000-4000-8000-000000000001',
   '60610000-0000-4000-8000-000000000001', 'Draft butter', 'butter-6', 'GHS', 999999, 'draft', 'track', 5, null),
  ('60640000-0000-4000-8000-000000000007', '60620000-0000-4000-8000-000000000002',
   '60610000-0000-4000-8000-000000000002', 'Lagos butter', 'butter-7', 'NGN', 888888, 'active', 'track', 5, now());
insert into public.product_categories (product_id, category_id)
values
  ('60640000-0000-4000-8000-000000000005', '60630000-0000-4000-8000-000000000001'),
  ('60640000-0000-4000-8000-000000000006', '60630000-0000-4000-8000-000000000001'),
  ('60640000-0000-4000-8000-000000000007', '60630000-0000-4000-8000-000000000001');

select is((select sample_size from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), 5,
  'drafts and other countries are not in the sample');
select is((select median_minor from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), 3000::bigint,
  'median of 1000..5000 is 3000');
select is((select p25_minor from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), 2000::bigint,
  'p25 of 1000..5000 is 2000');
select is((select p75_minor from public.suggest_price('60630000-0000-4000-8000-000000000001', 'GH')), 4000::bigint,
  'p75 of 1000..5000 is 4000');

select * from finish();
rollback;
