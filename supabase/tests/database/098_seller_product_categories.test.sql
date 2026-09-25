-- Sellers categorising their own products (202609250263). RLS is the whole
-- boundary: mobile writes product_categories with the seller's JWT.

begin;

set local search_path = extensions, public;

select plan(15);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('09800000-0000-4000-8000-00000000000' || g)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'cat' || g || '@test.test', now(), now()
  from generate_series(1, 6) g;

-- 1 owner A (active), 2 owner B (active), 3 manager of A, 4 analyst of A,
-- 5 owner C (suspended), 6 manager of C.
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name) values
  ('09810000-0000-4000-8000-000000000001', '09800000-0000-4000-8000-000000000001', 'GH', 'active', true, 'A'),
  ('09810000-0000-4000-8000-000000000002', '09800000-0000-4000-8000-000000000002', 'GH', 'active', true, 'B'),
  ('09810000-0000-4000-8000-000000000005', '09800000-0000-4000-8000-000000000005', 'GH', 'suspended', false, 'C');

insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at) values
  ('09820000-0000-4000-8000-000000000001', '09810000-0000-4000-8000-000000000001', 'cat-shop-a', 'A', 'GH', 'GHS', 'published', now()),
  ('09820000-0000-4000-8000-000000000002', '09810000-0000-4000-8000-000000000002', 'cat-shop-b', 'B', 'GH', 'GHS', 'published', now()),
  ('09820000-0000-4000-8000-000000000005', '09810000-0000-4000-8000-000000000005', 'cat-shop-c', 'C', 'GH', 'GHS', 'published', now());

insert into public.team_memberships (seller_account_id, auth_user_id, email, role, active) values
  ('09810000-0000-4000-8000-000000000001', '09800000-0000-4000-8000-000000000003', 'cat3@test.test', 'manager', true),
  ('09810000-0000-4000-8000-000000000001', '09800000-0000-4000-8000-000000000004', 'cat4@test.test', 'analyst', true),
  ('09810000-0000-4000-8000-000000000005', '09800000-0000-4000-8000-000000000006', 'cat6@test.test', 'manager', true);

insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, published_at, inventory_policy, stock_quantity) values
  ('09830000-0000-4000-8000-000000000001', '09820000-0000-4000-8000-000000000001', '09810000-0000-4000-8000-000000000001', 'A1', 'cat-a1', 'GHS', 1000, 'active', now(), 'track', 1),
  ('09830000-0000-4000-8000-000000000002', '09820000-0000-4000-8000-000000000002', '09810000-0000-4000-8000-000000000002', 'B1', 'cat-b1', 'GHS', 1000, 'active', now(), 'track', 1),
  ('09830000-0000-4000-8000-000000000005', '09820000-0000-4000-8000-000000000005', '09810000-0000-4000-8000-000000000005', 'C1', 'cat-c1', 'GHS', 1000, 'draft', null, 'track', 1);

insert into public.categories (id, name, slug, active) values
  ('09840000-0000-4000-8000-000000000001', 'Beauty (test)', 'beauty-test-098', true),
  ('09840000-0000-4000-8000-000000000002', 'Fashion (test)', 'fashion-test-098', true),
  ('09840000-0000-4000-8000-000000000003', 'Retired (test)', 'retired-test-098', false);

-- ── Owner sets and changes a category ───────────────────────────────────────
select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000001","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000001', '09840000-0000-4000-8000-000000000001') $$,
  'an owner categorises their own product');
reset role;
select is(
  (select array_agg(category_id::text) from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001'),
  array['09840000-0000-4000-8000-000000000001'], 'one row, the chosen category');
select is(
  (select assigned_by from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001'),
  '09800000-0000-4000-8000-000000000001'::uuid, 'attributed to the seller who set it');

select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000001","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000001', '09840000-0000-4000-8000-000000000002') $$,
  'changing it replaces the old one');
reset role;
select is(
  (select array_agg(category_id::text) from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001'),
  array['09840000-0000-4000-8000-000000000002'], 'still exactly one row');

-- ── Cross-tenant and spoofing ───────────────────────────────────────────────
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000002","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000001', '09840000-0000-4000-8000-000000000001') $$,
  '42501', null, 'another seller cannot recategorise a product they can see on the storefront');
reset role;

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.product_categories (product_id, category_id, assigned_by)
     values ('09830000-0000-4000-8000-000000000001', '09840000-0000-4000-8000-000000000001', '09800000-0000-4000-8000-000000000002') $$,
  '42501', null, 'nor insert into its categories directly');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001'),
  1, 'nor delete them');

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000002","role":"authenticated"}';
     insert into public.product_categories (product_id, category_id, assigned_by)
     values ('09830000-0000-4000-8000-000000000002', '09840000-0000-4000-8000-000000000001', '09800000-0000-4000-8000-000000000001') $$,
  '42501', null, 'an assignment cannot be attributed to someone else');
reset role;

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000002","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000002', '09840000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a retired category cannot be attached');
reset role;

-- ── Team ────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000003","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000001', '09840000-0000-4000-8000-000000000001') $$,
  'a manager can categorise the account''s products');
reset role;

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000004","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000001', null) $$,
  '42501', null, 'an analyst cannot');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.product_categories where product_id = '09830000-0000-4000-8000-000000000001'),
  1, 'but an analyst can read them');
reset role;

-- ── Suspension ──────────────────────────────────────────────────────────────
select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000005","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000005', '09840000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a suspended owner cannot categorise');
reset role;

select throws_ok(
  $$ set local role authenticated;
     set local request.jwt.claims = '{"sub":"09800000-0000-4000-8000-000000000006","role":"authenticated"}';
     select public.set_product_category('09830000-0000-4000-8000-000000000005', '09840000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor can their manager');
reset role;

select * from finish();
rollback;
