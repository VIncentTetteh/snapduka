create table public.discovery_preferences(shop_id uuid primary key references public.shops(id) on delete cascade,seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,opted_in boolean not null default false,category text,city text,description text,operator_removed_at timestamptz,updated_at timestamptz not null default now());
create table public.discovery_listings(shop_id uuid primary key references public.shops(id) on delete cascade,seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,slug text not null,display_name text not null,country public.country_code not null,category text,city text,description text,quality_score integer not null default 0,active boolean not null default false,refreshed_at timestamptz not null default now());
alter table public.discovery_preferences enable row level security;alter table public.discovery_preferences force row level security;alter table public.discovery_listings enable row level security;alter table public.discovery_listings force row level security;
create policy discovery_preferences_owner_all on public.discovery_preferences for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy discovery_listings_public_read on public.discovery_listings for select to anon,authenticated using(active and refreshed_at>now()-interval '30 days' and exists(select 1 from public.shops where id=shop_id and status='published'));
create policy discovery_listings_owner_read on public.discovery_listings for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
grant select on public.discovery_listings to anon,authenticated;grant select,insert,update,delete on public.discovery_preferences to authenticated;grant all on public.discovery_preferences,public.discovery_listings to service_role;
create function public.refresh_discovery_listing(p_shop_id uuid) returns void language plpgsql security definer set search_path='' set row_security=off as $$begin
 insert into public.discovery_listings(shop_id,seller_account_id,slug,display_name,country,category,city,description,quality_score,active,refreshed_at)
 select s.id,s.seller_account_id,s.slug,s.display_name,s.country,p.category,p.city,p.description,
  least(100,(select count(*)*2 from public.products where shop_id=s.id and status='active')+(case when s.published_at is not null then 20 else 0 end)),
  p.opted_in and p.operator_removed_at is null and s.status='published',now()
 from public.shops s join public.discovery_preferences p on p.shop_id=s.id where s.id=p_shop_id
 on conflict(shop_id) do update set slug=excluded.slug,display_name=excluded.display_name,country=excluded.country,category=excluded.category,city=excluded.city,description=excluded.description,quality_score=excluded.quality_score,active=excluded.active,refreshed_at=now();
end$$;
grant execute on function public.refresh_discovery_listing(uuid) to authenticated,service_role;
