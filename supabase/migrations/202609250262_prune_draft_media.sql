-- Abandoned Snap-to-list photos.
--
-- Mobile Snap-to-list uploads the photo to `{seller}/drafts/{uuid}.jpg` in the
-- product-images bucket *before* a product exists, so the same upload can
-- become the product's first photo when the seller saves (no second upload over
-- a metered connection). A seller who snaps, reads the draft and walks away
-- leaves that object behind forever: nothing references it, the bucket is
-- public-read, and storage is billed by the byte.
--
-- A daily worker (/api/internal/storage/prune-drafts) removes draft objects
-- older than 48 hours that no product_media row points at. It deletes through
-- the Storage API rather than here: storage.objects has a protect_delete
-- trigger, and a row deleted in SQL would orphan the object in the backing
-- store anyway. So this function only *selects* candidates; the worker removes
-- them.
--
-- The rules are all in the WHERE clause, so there is exactly one place that
-- decides what is deletable:
--   * bucket product-images only;
--   * the second path segment is exactly 'drafts', and there is nothing deeper
--     than `{seller}/drafts/{file}` — product photos live at
--     `{seller}/{productId}/{file}` and can never match;
--   * created more than p_min_age ago (48h from the worker): a seller part way
--     through the form must not have their photo vanish before they save;
--   * no product_media row references the path — the saved product keeps the
--     draft path as its object_path, so this is what protects a real listing.
--
-- Keyset-paged by name: a candidate the Storage API refuses to delete stays a
-- candidate, and without a cursor it would sit at the head of every page and
-- starve everything behind it while the job reported success.

create or replace function public.draft_media_prune_candidates(
  p_min_age interval default interval '48 hours',
  p_after text default null,
  p_limit integer default 100
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'product-images'
     and o.name ~ '^[0-9a-f-]{36}/drafts/[^/]+$'
     and o.created_at < now() - greatest(p_min_age, interval '1 hour')
     and (p_after is null or o.name > p_after)
     and not exists (
       select 1 from public.product_media m where m.object_path = o.name
     )
   order by o.name
   limit least(greatest(p_limit, 1), 500);
$$;

comment on function public.draft_media_prune_candidates(interval, text, integer) is
  'Snap-to-list draft photos ({seller}/drafts/{file}) older than p_min_age (at least 1h) and referenced by no product_media row. Selects only; the prune worker deletes via the Storage API. service_role only.';

revoke all on function public.draft_media_prune_candidates(interval, text, integer) from public, anon, authenticated;
grant execute on function public.draft_media_prune_candidates(interval, text, integer) to service_role;

-- 03:20 UTC: the quietest hour in Accra and Lagos, and clear of the other
-- nightly jobs on the hour and at :40.
select cron.schedule(
  'snapduka-prune-draft-media',
  '20 3 * * *',
  $$select public.run_internal_job('/api/internal/storage/prune-drafts')$$
);
