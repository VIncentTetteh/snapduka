-- Operator moderation state on products, tightened seller write privileges,
-- and admin-managed global categories.

alter table public.products
  add column moderation_status text not null default 'clear',
  add column moderation_reason text,
  add column moderated_by uuid references auth.users (id),
  add column moderated_at timestamptz,
  add constraint products_moderation_status_check
    check (moderation_status in ('clear', 'hidden', 'flagged'));

create index products_moderation_status_idx
  on public.products (moderation_status)
  where moderation_status <> 'clear';

-- The table-level "grant update on products to authenticated" (202606120004)
-- combined with products_owner_update's with-check (which only constrains
-- `status`) would otherwise leave the new moderation columns writable by any
-- seller. Restrict `authenticated` to the columns sellers actually own,
-- mirroring seller_accounts' column-scoped grant in 202606120002_rls.sql.
revoke update on public.products from authenticated;
grant update (
  name, slug, description, currency, price_minor, compare_at_price_minor,
  sku, status, inventory_policy, stock_quantity, reserved_quantity, published_at
) on public.products to authenticated;

-- Storefront visibility must honor an operator hide regardless of the
-- seller-controlled status field.
drop policy products_public_read on public.products;
create policy products_public_read on public.products for select to anon, authenticated
using (
  status = 'active'
  and moderation_status <> 'hidden'
  and exists (
    select 1 from public.shops
    where shops.id = products.shop_id and shops.status = 'published'
  )
);

drop policy variants_public_read on public.product_variants;
create policy variants_public_read on public.product_variants for select to anon, authenticated
using (
  active and exists (
    select 1 from public.products
    join public.shops on shops.id = products.shop_id
    where products.id = product_variants.product_id
      and products.status = 'active'
      and products.moderation_status <> 'hidden'
      and shops.status = 'published'
  )
);

drop policy media_public_read on public.product_media;
create policy media_public_read on public.product_media for select to anon, authenticated
using (
  exists (
    select 1 from public.products
    join public.shops on shops.id = products.shop_id
    where products.id = product_media.product_id
      and products.status = 'active'
      and products.moderation_status <> 'hidden'
      and shops.status = 'published'
  )
);

drop policy collection_products_public_read on public.collection_products;
create policy collection_products_public_read on public.collection_products
for select to anon, authenticated
using (
  exists (
    select 1 from public.collections
    join public.products on products.id = collection_products.product_id
    join public.shops on shops.id = products.shop_id
    where collections.id = collection_products.collection_id
      and collections.active and products.status = 'active'
      and products.moderation_status <> 'hidden'
      and shops.status = 'published'
  )
);

-- Admin-managed global category taxonomy. Distinct from the seller-owned,
-- UI-less `collections` primitive: categories are operator-owned and
-- assigned platform-wide, not per-shop merchandising groupings.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_check check (btrim(name) <> ''),
  constraint categories_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

create table public.product_categories (
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create index product_categories_category_idx on public.product_categories (category_id);

alter table public.categories enable row level security;
alter table public.categories force row level security;
alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;

create policy categories_public_read on public.categories for select
to anon, authenticated
using (active);

create policy categories_operator_read on public.categories for select
to authenticated
using ((select public.is_operator()));

create policy product_categories_public_read on public.product_categories
for select to anon, authenticated
using (
  exists (
    select 1 from public.products
    join public.shops on shops.id = products.shop_id
    where products.id = product_categories.product_id
      and products.status = 'active'
      and products.moderation_status <> 'hidden'
      and shops.status = 'published'
  )
);

create policy product_categories_owner_read on public.product_categories
for select to authenticated
using (
  exists (
    select 1 from public.products
    where products.id = product_categories.product_id
      and products.seller_account_id = (select public.current_seller_account_id())
  )
);

create policy product_categories_operator_read on public.product_categories
for select to authenticated
using ((select public.is_operator()));

-- No INSERT/UPDATE/DELETE policies for `authenticated` on either table:
-- category CRUD and product-category assignment are operator-only actions,
-- always performed through the service-role admin client (matching every
-- other write in the admin console).
grant select on public.categories, public.product_categories to anon;
grant select on public.categories, public.product_categories to authenticated;
grant all on public.categories, public.product_categories to service_role;
