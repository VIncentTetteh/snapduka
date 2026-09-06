-- Stop anonymous callers enumerating every seller's media.
--
-- All three buckets carried an unconditional read policy — `bucket_id = 'x'`
-- and nothing else — for anon and authenticated. Storage's list API goes
-- through that policy, so an unauthenticated caller could walk the tree:
--
--   POST /storage/v1/object/list/product-images {"prefix":""}
--     -> every seller_account_id folder
--   POST .../list/product-images {"prefix":"<seller>/"}
--     -> every product_id folder
--   POST .../list/product-images {"prefix":"<seller>/<product>/"}
--     -> every filename, with size and mime type
--
-- Three calls, no credentials, and the whole platform's media library is
-- enumerable — including products that are draft, archived, or hidden by
-- moderation, which never appear on any storefront. The unguessable UUID in the
-- object path was doing no work, because the path did not have to be guessed.
--
-- What this does NOT change: fetching an object by a path you already have.
-- These buckets are marked public, and Supabase serves
-- /storage/v1/object/public/<bucket>/<path> without consulting RLS at all. That
-- is what every storefront image, shop logo and flyer uses, so removing the
-- blanket read policy leaves them working. Verified against production
-- immediately after applying.
--
-- Nothing in the app lists objects: the only storage calls are upload, remove
-- and getPublicUrl, and getPublicUrl builds a string without an API call. So
-- the read policy had no legitimate consumer.
--
-- A seller keeps read access to their own folder. Not needed by any current
-- call site, but a seller inspecting their own uploads is exactly the access
-- this bucket layout is designed around, and scoping it to the folder is the
-- same rule the insert, update and delete policies already use.

drop policy if exists media_public_read on storage.objects;
drop policy if exists campaign_media_public_read on storage.objects;

create policy media_seller_read on storage.objects
  for select to authenticated
  using (
    bucket_id = any (array['product-images', 'shop-logos', 'campaign-media'])
    and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
  );

-- The property: no policy grants a blanket read of a whole bucket.
do $$
declare blanket text;
begin
  select string_agg(polname, ', ')
  into blanket
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'
    and pol.polcmd in ('r', '*')
    and pg_get_expr(pol.polqual, pol.polrelid) not like '%foldername%';

  if blanket is not null then
    raise exception 'Storage policies still allow enumerating a bucket: %', blanket;
  end if;
end $$;
