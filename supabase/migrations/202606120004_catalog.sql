create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  currency public.currency_code not null,
  price_minor bigint not null,
  compare_at_price_minor bigint,
  sku text,
  status public.product_status not null default 'draft',
  inventory_policy public.inventory_policy not null default 'track',
  stock_quantity integer,
  reserved_quantity integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_shop_slug_key unique (shop_id, slug),
  constraint products_id_seller_key unique (id, seller_account_id),
  constraint products_name_check check (btrim(name) <> ''),
  constraint products_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint products_price_check check (price_minor >= 0),
  constraint products_compare_price_check check (
    compare_at_price_minor is null or compare_at_price_minor > price_minor
  ),
  constraint products_sku_check check (sku is null or btrim(sku) <> ''),
  constraint products_stock_check check (
    reserved_quantity >= 0
    and (
      (inventory_policy = 'track' and stock_quantity is not null and stock_quantity >= 0)
      or (inventory_policy <> 'track' and stock_quantity is null)
    )
    and (inventory_policy <> 'track' or reserved_quantity <= stock_quantity)
  ),
  constraint products_published_check check (
    status <> 'active' or published_at is not null
  )
);

create index products_shop_status_idx on public.products (shop_id, status, created_at desc);
create index products_seller_status_idx on public.products (seller_account_id, status, updated_at desc);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  name text not null,
  sku text,
  price_minor bigint,
  image_path text,
  inventory_policy public.inventory_policy not null default 'track',
  stock_quantity integer,
  reserved_quantity integer not null default 0,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_product_name_key unique (product_id, name),
  constraint product_variants_id_seller_key unique (id, seller_account_id),
  constraint product_variants_name_check check (btrim(name) <> ''),
  constraint product_variants_sku_check check (sku is null or btrim(sku) <> ''),
  constraint product_variants_price_check check (price_minor is null or price_minor >= 0),
  constraint product_variants_image_path_check check (
    image_path is null or btrim(image_path) <> ''
  ),
  constraint product_variants_position_check check (position >= 0),
  constraint product_variants_stock_check check (
    reserved_quantity >= 0
    and (
      (inventory_policy = 'track' and stock_quantity is not null and stock_quantity >= 0)
      or (inventory_policy <> 'track' and stock_quantity is null)
    )
    and (inventory_policy <> 'track' or reserved_quantity <= stock_quantity)
  )
);

create unique index product_variants_seller_sku_idx
  on public.product_variants (seller_account_id, sku)
  where sku is not null;

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  object_path text not null,
  alt_text text not null default '',
  width integer not null,
  height integer not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint product_media_object_path_key unique (object_path),
  constraint product_media_dimensions_check check (
    width > 0 and height > 0 and width <= 1000 and height <= 1000
  ),
  constraint product_media_position_check check (position >= 0)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_shop_slug_key unique (shop_id, slug),
  constraint collections_name_check check (btrim(name) <> ''),
  constraint collections_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.collection_products (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (collection_id, product_id),
  constraint collection_products_position_check check (position >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  quantity_delta integer not null,
  reason text not null,
  reference text,
  created_at timestamptz not null default now(),
  constraint inventory_movements_delta_check check (quantity_delta <> 0),
  constraint inventory_movements_reason_check check (btrim(reason) <> '')
);

create index inventory_movements_product_idx
  on public.inventory_movements (product_id, variant_id, created_at desc);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  quantity integer not null,
  reference text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_reservations_reference_key unique (reference),
  constraint stock_reservations_quantity_check check (quantity > 0),
  constraint stock_reservations_reference_check check (btrim(reference) <> ''),
  constraint stock_reservations_status_check check (
    status in ('active', 'released', 'consumed', 'expired')
  )
);

create index stock_reservations_expiry_idx
  on public.stock_reservations (status, expires_at)
  where status = 'active';

create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();
create trigger collections_set_updated_at before update on public.collections
for each row execute function public.set_updated_at();
create trigger stock_reservations_set_updated_at before update on public.stock_reservations
for each row execute function public.set_updated_at();

create function public.reserve_product_stock(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_reference text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  product_record public.products%rowtype;
  variant_record public.product_variants%rowtype;
  reservation_id uuid;
begin
  if p_quantity <= 0 or btrim(coalesce(p_reference, '')) = '' or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'Invalid stock reservation.';
  end if;

  select id into reservation_id
  from public.stock_reservations
  where reference = p_reference;

  if reservation_id is not null then
    return reservation_id;
  end if;

  select * into product_record
  from public.products
  where id = p_product_id and status = 'active'
  for update;

  if product_record.id is null then
    raise exception using errcode = 'P0001', message = 'Product is unavailable.';
  end if;

  if p_variant_id is not null then
    select * into variant_record
    from public.product_variants
    where id = p_variant_id and product_id = p_product_id and active
    for update;

    if variant_record.id is null then
      raise exception using errcode = 'P0001', message = 'Variant is unavailable.';
    end if;

    if variant_record.inventory_policy = 'track'
      and variant_record.stock_quantity - variant_record.reserved_quantity < p_quantity
    then
      raise exception using errcode = 'P0001', message = 'Insufficient stock.';
    end if;

    if variant_record.inventory_policy = 'track' then
      update public.product_variants
      set reserved_quantity = reserved_quantity + p_quantity
      where id = variant_record.id;
    end if;
  else
    if product_record.inventory_policy = 'track'
      and product_record.stock_quantity - product_record.reserved_quantity < p_quantity
    then
      raise exception using errcode = 'P0001', message = 'Insufficient stock.';
    end if;

    if product_record.inventory_policy = 'track' then
      update public.products
      set reserved_quantity = reserved_quantity + p_quantity
      where id = product_record.id;
    end if;
  end if;

  insert into public.stock_reservations (
    product_id, variant_id, seller_account_id, quantity, reference, expires_at
  )
  values (
    product_record.id, p_variant_id, product_record.seller_account_id,
    p_quantity, p_reference, p_expires_at
  )
  returning id into reservation_id;

  return reservation_id;
end;
$$;

create function public.finish_stock_reservation(
  p_reservation_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  reservation_record public.stock_reservations%rowtype;
begin
  if p_outcome not in ('released', 'consumed', 'expired') then
    raise exception using errcode = '22023', message = 'Invalid reservation outcome.';
  end if;

  select * into reservation_record
  from public.stock_reservations
  where id = p_reservation_id
  for update;

  if reservation_record.id is null or reservation_record.status <> 'active' then
    return;
  end if;

  if reservation_record.variant_id is not null then
    update public.product_variants
    set
      reserved_quantity = reserved_quantity - reservation_record.quantity,
      stock_quantity = case
        when p_outcome = 'consumed' and inventory_policy = 'track'
          then stock_quantity - reservation_record.quantity
        else stock_quantity
      end
    where id = reservation_record.variant_id;
  else
    update public.products
    set
      reserved_quantity = reserved_quantity - reservation_record.quantity,
      stock_quantity = case
        when p_outcome = 'consumed' and inventory_policy = 'track'
          then stock_quantity - reservation_record.quantity
        else stock_quantity
      end
    where id = reservation_record.product_id;
  end if;

  update public.stock_reservations
  set status = p_outcome
  where id = reservation_record.id;

  if p_outcome = 'consumed' then
    insert into public.inventory_movements (
      product_id, variant_id, seller_account_id, quantity_delta, reason, reference
    )
    values (
      reservation_record.product_id,
      reservation_record.variant_id,
      reservation_record.seller_account_id,
      -reservation_record.quantity,
      'sale',
      reservation_record.reference
    );
  end if;
end;
$$;

alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.product_variants enable row level security;
alter table public.product_variants force row level security;
alter table public.product_media enable row level security;
alter table public.product_media force row level security;
alter table public.collections enable row level security;
alter table public.collections force row level security;
alter table public.collection_products enable row level security;
alter table public.collection_products force row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;
alter table public.stock_reservations enable row level security;
alter table public.stock_reservations force row level security;

create policy products_public_read on public.products for select to anon, authenticated
using (
  status = 'active'
  and exists (
    select 1 from public.shops
    where shops.id = products.shop_id and shops.status = 'published'
  )
);
create policy products_owner_operator_read on public.products for select to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);
create policy products_owner_insert on public.products for insert to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and exists (
    select 1 from public.shops
    where shops.id = products.shop_id
      and shops.seller_account_id = products.seller_account_id
      and shops.currency = products.currency
  )
);
create policy products_owner_update on public.products for update to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and status in ('draft', 'active', 'archived')
);

create policy variants_public_read on public.product_variants for select to anon, authenticated
using (
  active and exists (
    select 1 from public.products
    join public.shops on shops.id = products.shop_id
    where products.id = product_variants.product_id
      and products.status = 'active'
      and shops.status = 'published'
  )
);
create policy variants_owner_all on public.product_variants for all to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and exists (
    select 1 from public.products
    where products.id = product_variants.product_id
      and products.seller_account_id = product_variants.seller_account_id
  )
);
create policy variants_operator_read on public.product_variants for select to authenticated
using ((select public.is_operator()));

create policy media_public_read on public.product_media for select to anon, authenticated
using (
  exists (
    select 1 from public.products
    join public.shops on shops.id = products.shop_id
    where products.id = product_media.product_id
      and products.status = 'active'
      and shops.status = 'published'
  )
);
create policy media_owner_all on public.product_media for all to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
);
create policy media_operator_read on public.product_media for select to authenticated
using ((select public.is_operator()));

create policy collections_public_read on public.collections for select to anon, authenticated
using (
  active and exists (
    select 1 from public.shops
    where shops.id = collections.shop_id and shops.status = 'published'
  )
);
create policy collections_owner_all on public.collections for all to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (seller_account_id = (select public.current_seller_account_id()));
create policy collections_operator_read on public.collections for select to authenticated
using ((select public.is_operator()));

create policy collection_products_public_read on public.collection_products
for select to anon, authenticated
using (
  exists (
    select 1 from public.collections
    join public.products on products.id = collection_products.product_id
    join public.shops on shops.id = products.shop_id
    where collections.id = collection_products.collection_id
      and collections.active and products.status = 'active'
      and shops.status = 'published'
  )
);
create policy collection_products_owner_all on public.collection_products
for all to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (seller_account_id = (select public.current_seller_account_id()));
create policy collection_products_operator_read on public.collection_products
for select to authenticated using ((select public.is_operator()));

create policy inventory_owner_operator_read on public.inventory_movements
for select to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);
create policy reservations_owner_operator_read on public.stock_reservations
for select to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

grant select on public.products, public.product_variants, public.product_media,
  public.collections, public.collection_products to anon;
grant select, insert, update, delete on public.products, public.product_variants,
  public.product_media, public.collections, public.collection_products to authenticated;
grant select on public.inventory_movements, public.stock_reservations to authenticated;
grant execute on function public.reserve_product_stock(uuid, uuid, integer, text, timestamptz)
  to authenticated, service_role;
grant execute on function public.finish_stock_reservation(uuid, text) to service_role;
grant all on public.products, public.product_variants, public.product_media,
  public.collections, public.collection_products, public.inventory_movements,
  public.stock_reservations to service_role;
