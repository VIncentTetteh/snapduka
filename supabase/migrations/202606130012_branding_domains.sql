create type public.domain_status as enum ('pending','verified','failed','disabled');

create table public.shop_branding (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  logo_path text,
  banner_path text,
  accent_color text not null default '#146b45' check(accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  surface_color text not null default '#ffffff' check(surface_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family text not null default 'system' check(font_family in ('system','rounded','serif')),
  hide_snapduka_branding boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  hostname text not null unique check(hostname=lower(hostname)),
  verification_token text not null default encode(extensions.gen_random_bytes(24),'hex'),
  status public.domain_status not null default 'pending',
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.shop_branding enable row level security;
alter table public.shop_branding force row level security;
alter table public.custom_domains enable row level security;
alter table public.custom_domains force row level security;
create policy branding_public_read on public.shop_branding for select to anon,authenticated using(exists(select 1 from public.shops s where s.id=shop_id and s.status='published'));
create policy branding_owner_all on public.shop_branding for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy domains_public_verified on public.custom_domains for select to anon,authenticated using(status='verified');
create policy domains_owner_all on public.custom_domains for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy subscriptions_owner_insert on public.seller_subscriptions for insert to authenticated with check(seller_account_id=(select public.current_seller_account_id()));
create policy subscriptions_owner_update on public.seller_subscriptions for update to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
grant select on public.shop_branding,public.custom_domains to anon;
grant select,insert,update,delete on public.shop_branding,public.custom_domains to authenticated;
grant insert,update on public.seller_subscriptions to authenticated;
grant all on public.shop_branding,public.custom_domains to service_role;
