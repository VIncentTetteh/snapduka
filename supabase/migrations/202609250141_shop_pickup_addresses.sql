-- Where a courier collects a shop's parcels.
--
-- A courier cannot quote without a pickup point, and SnapDuka has never stored
-- one: shops have a name and a country, and the only address in the schema is
-- the buyer's. For most sellers the pickup point is their home, so it is kept
-- out of `shops`, which anon can read in full (table-level SELECT for the
-- storefront). A separate table, owner- and team-only, keeps it private.
--
-- The address is the same normalised shape as orders.delivery_address
-- (packages/core/src/addresses/types.ts); its structure is validated in the
-- app, and here only as "is an object with a city".

create table public.shop_pickup_addresses (
  shop_id uuid primary key,
  seller_account_id uuid not null,
  address jsonb not null,
  contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_pickup_addresses_shop_same_seller
    foreign key (shop_id, seller_account_id)
    references public.shops (id, seller_account_id) on delete cascade,
  constraint shop_pickup_addresses_address_check check (
    jsonb_typeof(address) = 'object'
    and coalesce(btrim(address->>'city'), '') <> ''
  )
);

comment on table public.shop_pickup_addresses is
  'Courier pickup point per shop. Private: never exposed to anon, unlike shops.';

create index shop_pickup_addresses_seller_idx on public.shop_pickup_addresses (seller_account_id);

alter table public.shop_pickup_addresses enable row level security;
alter table public.shop_pickup_addresses force row level security;
revoke all on public.shop_pickup_addresses from anon;

create trigger shop_pickup_addresses_set_updated_at
  before update on public.shop_pickup_addresses
  for each row execute function public.set_updated_at();

-- Suspension predicate in both USING and WITH CHECK (see 202609050089).
create policy shop_pickup_addresses_owner_all on public.shop_pickup_addresses
  for all to authenticated
  using (
    seller_account_id = (select public.current_seller_account_id())
    and (select public.current_seller_status()) in ('pending', 'active')
  )
  with check (
    seller_account_id = (select public.current_seller_account_id())
    and (select public.current_seller_status()) in ('pending', 'active')
  );

-- The fulfilment matrix: managers and fulfilment staff arrange deliveries, so
-- they may set where the courier comes; support may only see it.
create policy shop_pickup_addresses_team_read on public.shop_pickup_addresses
  for select to authenticated
  using ((select public.team_has_role(seller_account_id,
    array['manager', 'fulfillment', 'support']::public.team_role[])));

create policy shop_pickup_addresses_team_write on public.shop_pickup_addresses
  for all to authenticated
  using (
    (select public.team_has_role(seller_account_id, array['manager', 'fulfillment']::public.team_role[]))
    and public.seller_account_operable(seller_account_id)
  )
  with check (
    (select public.team_has_role(seller_account_id, array['manager', 'fulfillment']::public.team_role[]))
    and public.seller_account_operable(seller_account_id)
  );

grant select, insert, update, delete on public.shop_pickup_addresses to authenticated;
