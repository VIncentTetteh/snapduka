-- supabase/migrations/202607180031_product_video.sql
-- Product video: sellers link an existing YouTube/TikTok/Vimeo/Instagram
-- video per product; buyers see it as the first gallery slide. No file
-- storage — just a resolved link + thumbnail. Free on every plan.

alter table public.products
  add column video_url text,
  add column video_provider text
    check (video_provider in ('youtube', 'tiktok', 'vimeo', 'instagram', 'other')),
  add column video_id text,
  add column video_thumbnail_url text,
  add constraint products_video_url_provider_check
    check ((video_url is null) = (video_provider is null));

-- Sellers already have table-level UPDATE restricted to an explicit column
-- list (202607180030_product_moderation.sql) — add the new seller-writable
-- columns to that allowlist. This is additive; it does not touch the
-- existing grant.
grant update (video_url, video_provider, video_id, video_thumbnail_url)
  on public.products to authenticated;
