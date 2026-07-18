begin;

set local search_path = extensions, public;

select plan(14);

select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'product_categories', 'product_categories table exists');
select has_column('public', 'products', 'moderation_status', 'products has moderation_status');
select has_column('public', 'products', 'moderation_reason', 'products has moderation_reason');
select has_column('public', 'products', 'moderated_by', 'products has moderated_by');
select has_column('public', 'products', 'moderated_at', 'products has moderated_at');

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('categories', 'product_categories')
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  2::bigint,
  'category tables force RLS'
);

-- Sellers must not be able to write moderation state directly: only the
-- seller-owned columns should remain grantable to `authenticated`.
select is(
  has_column_privilege('authenticated', 'public.products', 'status', 'UPDATE'),
  true,
  'sellers can still update their own status column'
);
select is(
  has_column_privilege('authenticated', 'public.products', 'moderation_status', 'UPDATE'),
  false,
  'sellers cannot update moderation_status'
);
select is(
  has_column_privilege('authenticated', 'public.products', 'moderated_by', 'UPDATE'),
  false,
  'sellers cannot update moderated_by'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000005101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'moderation@example.com', '',
  now(), '{}'::jsonb, now(), now()
);

insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000005201',
  '00000000-0000-0000-0000-000000005101',
  'GH', 'active', true, 'Moderation Seller',
  'moderation@example.com', '+233241234572'
);

insert into public.shops (
  id, seller_account_id, slug, display_name, legal_name,
  country, currency, status, published_at
)
values (
  '00000000-0000-0000-0000-000000005301',
  '00000000-0000-0000-0000-000000005201',
  'moderation-shop', 'Moderation Shop', 'Moderation Shop Ltd',
  'GH', 'GHS', 'published', now()
);

insert into public.products (
  id, shop_id, seller_account_id, name, slug, description,
  currency, price_minor, status, inventory_policy, stock_quantity, published_at
)
values (
  '00000000-0000-0000-0000-000000005401',
  '00000000-0000-0000-0000-000000005301',
  '00000000-0000-0000-0000-000000005201',
  'Banned item', 'banned-item', '', 'GHS', 1500,
  'active', 'track', 5, now()
);

set local role anon;

select is(
  (select count(*) from public.products where slug = 'banned-item'),
  1::bigint,
  'anonymous buyer can read the product before moderation'
);

reset role;

-- Operator hide, applied the same way the admin service-role client would.
update public.products
set moderation_status = 'hidden', moderation_reason = 'policy violation', moderated_at = now()
where id = '00000000-0000-0000-0000-000000005401';

set local role anon;

select is(
  (select count(*) from public.products where slug = 'banned-item'),
  0::bigint,
  'anonymous buyer cannot read a product operator-hidden, even though status is still active'
);
select is(
  (select count(*) from public.product_variants where product_id = '00000000-0000-0000-0000-000000005401'),
  0::bigint,
  'anonymous buyer cannot read variants of a hidden product'
);

reset role;

insert into public.categories (id, name, slug, active)
values ('00000000-0000-0000-0000-000000005501', 'Electronics', 'electronics', true);
insert into public.categories (id, name, slug, active)
values ('00000000-0000-0000-0000-000000005502', 'Archived Category', 'archived-category', false);

set local role anon;

select is(
  (select count(*) from public.categories where active),
  1::bigint,
  'anonymous buyer only sees active categories'
);

select * from finish();
rollback;
