create table public.analytics_events (
  id uuid primary key,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  session_id uuid not null,
  event_type text not null,
  product_id uuid references public.products(id) on delete set null,
  source text,
  campaign text,
  country public.country_code,
  dimensions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint analytics_event_type_check check(event_type in ('visit','product_view','checkout_start')),
  constraint analytics_safe_dimensions_check check(
    not public.jsonb_has_sensitive_account_key(dimensions)
    and not dimensions ?| array['email','phone','address','name','payment']
  )
);
create index analytics_seller_time_idx on public.analytics_events(seller_account_id,created_at desc);
alter table public.analytics_events enable row level security; alter table public.analytics_events force row level security;
create policy analytics_owner_operator on public.analytics_events for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
grant select on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;
