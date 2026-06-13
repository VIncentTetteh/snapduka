create table public.fulfillment_methods (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  type text not null,
  name text not null,
  fee_minor bigint not null default 0,
  instructions text not null default '',
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfillment_methods_type_check check (type in ('delivery', 'pickup')),
  constraint fulfillment_methods_name_check check (btrim(name) <> ''),
  constraint fulfillment_methods_fee_check check (fee_minor >= 0),
  constraint fulfillment_methods_position_check check (position >= 0)
);

create trigger fulfillment_methods_set_updated_at before update on public.fulfillment_methods
for each row execute function public.set_updated_at();

alter table public.fulfillment_methods enable row level security;
alter table public.fulfillment_methods force row level security;

create policy fulfillment_public_read on public.fulfillment_methods
for select to anon, authenticated using (
  active and exists (
    select 1 from public.shops
    where shops.id = fulfillment_methods.shop_id and shops.status = 'published'
  )
);
create policy fulfillment_owner_all on public.fulfillment_methods
for all to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and exists (
    select 1 from public.shops
    where shops.id = fulfillment_methods.shop_id
      and shops.seller_account_id = fulfillment_methods.seller_account_id
  )
);
create policy fulfillment_operator_read on public.fulfillment_methods
for select to authenticated using ((select public.is_operator()));

grant select on public.fulfillment_methods to anon;
grant select, insert, update, delete on public.fulfillment_methods to authenticated;
grant all on public.fulfillment_methods to service_role;
