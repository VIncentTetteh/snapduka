begin;

set local search_path = extensions, public;

select plan(17);

select has_table('public', 'products', 'products table exists');
select has_table('public', 'product_variants', 'variants table exists');
select has_table('public', 'product_media', 'media table exists');
select has_table('public', 'collections', 'collections table exists');
select has_table('public', 'collection_products', 'collection products table exists');
select has_table('public', 'inventory_movements', 'inventory ledger exists');
select has_table('public', 'stock_reservations', 'stock reservations exist');
select has_function(
  'public',
  'reserve_product_stock',
  array['uuid', 'uuid', 'integer', 'text', 'timestamptz']::name[],
  'stock reservation helper exists'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'products',
        'product_variants',
        'product_media',
        'collections',
        'collection_products',
        'inventory_movements',
        'stock_reservations'
      )
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  7::bigint,
  'catalog tables force RLS'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000004101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'catalog@example.com', '',
  now(), '{}'::jsonb, now(), now()
);

insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000004201',
  '00000000-0000-0000-0000-000000004101',
  'GH', 'active', true, 'Catalog Seller',
  'catalog@example.com', '+233241234571'
);

insert into public.shops (
  id, seller_account_id, slug, display_name, legal_name,
  country, currency, status, published_at
)
values (
  '00000000-0000-0000-0000-000000004301',
  '00000000-0000-0000-0000-000000004201',
  'catalog-shop', 'Catalog Shop', 'Catalog Shop Ltd',
  'GH', 'GHS', 'published', now()
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000004101","app_metadata":{}}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    insert into public.products (
      id, shop_id, seller_account_id, name, slug, description,
      currency, price_minor, status, inventory_policy, stock_quantity, published_at
    )
    values (
      '00000000-0000-0000-0000-000000004401',
      '00000000-0000-0000-0000-000000004301',
      '00000000-0000-0000-0000-000000004201',
      'Last item', 'last-item', '', 'GHS', 1200,
      'active', 'track', 1, now()
    )
  $$,
  'active seller can create a product'
);

select lives_ok(
  $$
    select public.reserve_product_stock(
      '00000000-0000-0000-0000-000000004401',
      null,
      1,
      'cart-one',
      now() + interval '15 minutes'
    )
  $$,
  'last item can be reserved once'
);

select throws_ok(
  $$
    select public.reserve_product_stock(
      '00000000-0000-0000-0000-000000004401',
      null,
      1,
      'cart-two',
      now() + interval '15 minutes'
    )
  $$,
  'P0001',
  'Insufficient stock.',
  'the same last item cannot be reserved twice'
);

reset role;
set local role anon;

select is(
  (select count(*) from public.products where slug = 'last-item'),
  1::bigint,
  'anonymous buyer can read active products in published shops'
);

reset role;
update public.products set status = 'draft'
where id = '00000000-0000-0000-0000-000000004401';
set local role anon;

select is(
  (select count(*) from public.products where slug = 'last-item'),
  0::bigint,
  'anonymous buyer cannot read draft products'
);

select is(
  has_table_privilege('anon', 'public.inventory_movements', 'SELECT'),
  false,
  'inventory ledger is private'
);
select is(
  has_table_privilege('anon', 'public.stock_reservations', 'SELECT'),
  false,
  'stock reservations are private'
);
select is(
  has_table_privilege('anon', 'public.product_variants', 'SELECT'),
  true,
  'anonymous buyers can query public variants through RLS'
);

select * from finish();
rollback;
