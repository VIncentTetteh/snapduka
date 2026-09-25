begin;

set local search_path = extensions, public;

select plan(6);

select results_eq(
  $$ select public from storage.buckets where id = 'product-images' $$,
  $$ values (true) $$,
  'product-images bucket exists and is public'
);

select results_eq(
  $$ select public from storage.buckets where id = 'shop-logos' $$,
  $$ values (true) $$,
  'shop-logos bucket exists and is public'
);

-- Public buckets serve objects by URL without consulting RLS, so storefront
-- images need no read policy; a blanket one only let anon LIST every seller's
-- files (202609060093). What must hold now is the opposite of what this test
-- used to assert: no unconditional read, only a seller's read of their folder.
select ok(
  not exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and cmd = 'SELECT' and 'anon' = any(roles))
  and exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'media_seller_read'),
  'media objects cannot be listed anonymously; sellers read their own folder'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'media_seller_insert'),
  'sellers can insert into their own media folder'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'media_seller_update'),
  'sellers can update their own media'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'media_seller_delete'),
  'sellers can delete their own media'
);

select * from finish();

rollback;
