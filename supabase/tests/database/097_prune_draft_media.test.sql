-- Abandoned Snap-to-list photo candidates (202609250262).

begin;

set local search_path = extensions, public;

select plan(10);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('09700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'drafts@test.test', now(), now());
insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name)
values ('09710000-0000-4000-8000-000000000001', '09700000-0000-4000-8000-000000000001', 'GH', 'active', true, 'Drafts');
insert into public.shops (id, seller_account_id, slug, display_name, country, currency, status, published_at)
values ('09720000-0000-4000-8000-000000000001', '09710000-0000-4000-8000-000000000001', 'drafts-shop', 'Drafts', 'GH', 'GHS', 'published', now());
insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, inventory_policy, stock_quantity)
values ('09730000-0000-4000-8000-000000000001', '09720000-0000-4000-8000-000000000001', '09710000-0000-4000-8000-000000000001',
        'Saved from a snap', 'saved-from-a-snap', 'GHS', 1000, 'draft', 'track', 1);

-- s = 09710000-0000-4000-8000-000000000001
insert into storage.objects (bucket_id, name, created_at) values
  -- abandoned: old, in drafts, unreferenced -> candidate
  ('product-images', '09710000-0000-4000-8000-000000000001/drafts/aaa-old.jpg', now() - interval '3 days'),
  ('product-images', '09710000-0000-4000-8000-000000000001/drafts/bbb-old.jpg', now() - interval '49 hours'),
  -- saved: old draft path, but the product uses it as its photo
  ('product-images', '09710000-0000-4000-8000-000000000001/drafts/ccc-saved.jpg', now() - interval '5 days'),
  -- recent: the seller may still be filling in the form
  ('product-images', '09710000-0000-4000-8000-000000000001/drafts/ddd-recent.jpg', now() - interval '30 minutes'),
  -- product photo: not a draft path at all
  ('product-images', '09710000-0000-4000-8000-000000000001/09730000-0000-4000-8000-000000000001/eee.jpg', now() - interval '30 days'),
  -- nested under drafts: not the shape Snap-to-list writes
  ('product-images', '09710000-0000-4000-8000-000000000001/drafts/nested/fff.jpg', now() - interval '30 days'),
  -- "drafts" as a product-ish folder name further down
  ('product-images', '09710000-0000-4000-8000-000000000001/09730000-0000-4000-8000-000000000001/drafts.jpg', now() - interval '30 days'),
  -- another bucket
  ('shop-logos', '09710000-0000-4000-8000-000000000001/drafts/ggg.jpg', now() - interval '30 days');

insert into public.product_media (product_id, seller_account_id, object_path, width, height)
values ('09730000-0000-4000-8000-000000000001', '09710000-0000-4000-8000-000000000001',
        '09710000-0000-4000-8000-000000000001/drafts/ccc-saved.jpg', 800, 800);

select ok(not has_function_privilege('authenticated', 'public.draft_media_prune_candidates(interval,text,integer)', 'execute'),
  'sellers cannot list other sellers'' abandoned drafts');
select ok(not has_function_privilege('anon', 'public.draft_media_prune_candidates(interval,text,integer)', 'execute'), 'nor can anon');

create temp table candidates as
  select name from public.draft_media_prune_candidates(interval '48 hours', null, 100)
   where name like '09710000-%';

select set_eq(
  $$select name from candidates$$,
  $$values ('09710000-0000-4000-8000-000000000001/drafts/aaa-old.jpg'),
           ('09710000-0000-4000-8000-000000000001/drafts/bbb-old.jpg')$$,
  'only old, unreferenced, top-level draft photos in product-images are candidates');
select ok(not exists (select 1 from candidates where name like '%ccc-saved%'), 'a draft photo a product uses is kept');
select ok(not exists (select 1 from candidates where name like '%ddd-recent%'), 'a recent draft is kept');
select ok(not exists (select 1 from candidates where name like '%/09730000-%'), 'product photos are never candidates');
select ok(not exists (select 1 from candidates where name like '%nested%'), 'nothing deeper than drafts/{file}');

-- Keyset: after the first candidate, only the second is returned.
select is(
  (select array_agg(name order by name) from public.draft_media_prune_candidates(
     interval '48 hours', '09710000-0000-4000-8000-000000000001/drafts/aaa-old.jpg', 100) where name like '09710000-%'),
  array['09710000-0000-4000-8000-000000000001/drafts/bbb-old.jpg'],
  'pages by name, so an undeletable object cannot starve the rest');

-- A caller cannot shrink the age floor below an hour.
select ok(not exists (
  select 1 from public.draft_media_prune_candidates(interval '0 seconds', null, 100) where name like '%ddd-recent%'),
  'the minimum age cannot be set below one hour');

select is((select schedule from cron.job where jobname = 'snapduka-prune-draft-media'), '20 3 * * *', 'scheduled daily');

select * from finish();
rollback;
