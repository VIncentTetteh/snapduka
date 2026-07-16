-- Storage buckets for product photos and shop logos. Objects are stored under
-- a per-seller folder ({seller_account_id}/...) so write access can be scoped
-- with row-level security; both buckets are public-read for storefront display.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880, array['image/webp','image/jpeg','image/png']),
  ('shop-logos', 'shop-logos', true, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

create policy "media_public_read" on storage.objects
for select to anon, authenticated
using (bucket_id in ('product-images','shop-logos'));

create policy "media_seller_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id in ('product-images','shop-logos')
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);

create policy "media_seller_update" on storage.objects
for update to authenticated
using (
  bucket_id in ('product-images','shop-logos')
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
)
with check (
  bucket_id in ('product-images','shop-logos')
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);

create policy "media_seller_delete" on storage.objects
for delete to authenticated
using (
  bucket_id in ('product-images','shop-logos')
  and (storage.foldername(name))[1] = (select public.current_seller_account_id())::text
);
