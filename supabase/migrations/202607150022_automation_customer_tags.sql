create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  tag text not null check (btrim(tag) <> ''),
  created_at timestamptz not null default now(),
  unique (customer_id, tag)
);

alter table public.customer_tags enable row level security;
alter table public.customer_tags force row level security;
create policy customer_tags_owner_all on public.customer_tags for all to authenticated
  using (seller_account_id = (select public.current_seller_account_id()))
  with check (seller_account_id = (select public.current_seller_account_id()));
grant select, insert, update, delete on public.customer_tags to authenticated;
grant all on public.customer_tags to service_role;
