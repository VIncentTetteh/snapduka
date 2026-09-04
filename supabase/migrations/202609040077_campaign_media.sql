-- supabase/migrations/202609040077_campaign_media.sql
--
-- Storage for campaign creative.
--
-- Follows 202607160024_media_storage.sql exactly: objects live under a
-- {seller_account_id}/... folder so writes can be scoped by RLS, and the bucket
-- is public-read because the creative is composited into the story card a
-- seller posts publicly.
--
-- The existing media policies are written against a hard-coded bucket list, so
-- this adds its own rather than editing theirs — a campaign is not a product
-- photo and a future change to one should not silently move the other.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-media', 'campaign-media', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "campaign_media_public_read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'campaign-media');

create policy "campaign_media_seller_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'campaign-media'
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);

create policy "campaign_media_seller_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'campaign-media'
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
)
with check (
  bucket_id = 'campaign-media'
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);

create policy "campaign_media_seller_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'campaign-media'
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);
