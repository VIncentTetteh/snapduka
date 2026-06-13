create type public.subscription_state as enum (
  'trialing','active','past_due','grace','cancelled','expired'
);

create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id),
  country public.country_code not null,
  currency public.currency_code not null,
  interval text not null check(interval in ('monthly','yearly')),
  amount_minor bigint not null check(amount_minor >= 0),
  provider text not null default 'paystack',
  provider_plan_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(plan_id,country,interval)
);

create table public.seller_subscriptions (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  plan_version integer not null,
  price_id uuid references public.plan_prices(id),
  state public.subscription_state not null default 'trialing',
  provider text not null default 'paystack',
  provider_customer_code text,
  provider_subscription_code text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(seller_account_id)
);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.seller_subscriptions(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.feature_usage (
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  capability text not null,
  period_start date not null,
  usage_count bigint not null default 0 check(usage_count >= 0),
  updated_at timestamptz not null default now(),
  primary key(seller_account_id,capability,period_start)
);

alter table public.seller_entitlements
  add column if not exists read_only_capabilities text[] not null default '{}';

alter table public.plan_prices enable row level security;
alter table public.plan_prices force row level security;
alter table public.seller_subscriptions enable row level security;
alter table public.seller_subscriptions force row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_events force row level security;
alter table public.feature_usage enable row level security;
alter table public.feature_usage force row level security;

create policy plan_prices_authenticated_read on public.plan_prices
for select to authenticated using(active or (select public.is_operator()));

create policy subscriptions_owner_operator_read on public.seller_subscriptions
for select to authenticated using(
  seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator())
);
create policy subscription_events_owner_operator_read on public.subscription_events
for select to authenticated using(
  seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator())
);
create policy feature_usage_owner_operator_read on public.feature_usage
for select to authenticated using(
  seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator())
);

grant select on public.plan_prices,public.seller_subscriptions,public.subscription_events,public.feature_usage to authenticated;
grant all on public.plan_prices,public.seller_subscriptions,public.subscription_events,public.feature_usage to service_role;

insert into public.plans(code,name,version,entitlements,active) values
('growth','Growth',1,'{
  "shops":1,"products":500,"staffAccounts":3,"customDomain":true,
  "branding":true,"promotions":true,"campaigns":true,"exports":true,
  "customerSegments":20,"broadcastsPerMonth":10,"automationRules":10,
  "apiKeys":2,"discovery":true
}'::jsonb,true),
('scale','Scale',1,'{
  "shops":1,"products":5000,"staffAccounts":15,"customDomain":true,
  "branding":true,"promotions":true,"campaigns":true,"exports":true,
  "customerSegments":100,"broadcastsPerMonth":100,"automationRules":100,
  "apiKeys":10,"courierIntegrations":true,"discovery":true
}'::jsonb,true);
