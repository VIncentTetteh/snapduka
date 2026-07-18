begin;

set local search_path = extensions, public;

select plan(8);

select has_column('public', 'products', 'video_url', 'products has video_url');
select has_column('public', 'products', 'video_provider', 'products has video_provider');
select has_column('public', 'products', 'video_id', 'products has video_id');
select has_column('public', 'products', 'video_thumbnail_url', 'products has video_thumbnail_url');

-- Sellers can write the new video columns (this is the actual enforcement
-- point for "sellers can attach a video" — column-level grant, not RLS).
select is(
  has_column_privilege('authenticated', 'public.products', 'video_url', 'UPDATE'),
  true,
  'sellers can update video_url'
);
select is(
  has_column_privilege('authenticated', 'public.products', 'video_provider', 'UPDATE'),
  true,
  'sellers can update video_provider'
);

-- video_url and video_provider must be set together, never one without the
-- other — insert a seller/shop/product fixture and assert the constraint.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000006101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'video-fixture@example.com', '',
  now(), '{}'::jsonb, now(), now()
);
insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000006201',
  '00000000-0000-0000-0000-000000006101',
  'GH', 'active', true, 'Video Fixture Seller',
  'video-fixture@example.com', '+233241234573'
);
insert into public.shops (
  id, seller_account_id, slug, display_name, legal_name,
  country, currency, status, published_at
)
values (
  '00000000-0000-0000-0000-000000006301',
  '00000000-0000-0000-0000-000000006201',
  'video-fixture-shop', 'Video Fixture Shop', 'Video Fixture Shop Ltd',
  'GH', 'GHS', 'published', now()
);

select throws_ok(
  $$
    insert into public.products (
      shop_id, seller_account_id, name, slug, description,
      currency, price_minor, status, inventory_policy, stock_quantity,
      video_url
    )
    values (
      '00000000-0000-0000-0000-000000006301',
      '00000000-0000-0000-0000-000000006201',
      'Video only, no provider', 'video-only-no-provider', '', 'GHS', 1000,
      'draft', 'track', 1,
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
  $$,
  '23514',
  null,
  'video_url without video_provider is rejected'
);

select throws_ok(
  $$
    insert into public.products (
      shop_id, seller_account_id, name, slug, description,
      currency, price_minor, status, inventory_policy, stock_quantity,
      video_provider
    )
    values (
      '00000000-0000-0000-0000-000000006301',
      '00000000-0000-0000-0000-000000006201',
      'Provider only, no URL', 'provider-only-no-url', '', 'GHS', 1000,
      'draft', 'track', 1,
      'youtube'
    )
  $$,
  '23514',
  null,
  'video_provider without video_url is rejected'
);

select * from finish();
rollback;
