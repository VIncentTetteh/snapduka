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

select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'media_public_read'),
  'media objects are publicly readable'
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
