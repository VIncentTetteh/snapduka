-- Feature flags with per-country and per-seller rollout.
--
-- Everything in the trust-and-money roadmap ships dark: Protect, ledger
-- settlement, instant payouts, the WhatsApp agent, AI listing, courier booking.
-- Each has to reach internal accounts, then a pilot cohort, then a percentage of
-- one country, and be switchable off in seconds without a deploy. Until now the
-- only switches were columns on country_configs, which are per-country only and
-- need a migration to flip.
--
-- Resolution, most specific first:
--   1. a row for this seller          (pilot cohorts, kill switch for one shop)
--   2. a row for the seller's country (market rollout)
--   3. the global row                 (country_code and seller both null)
-- Within the winning row, `percentage` buckets sellers deterministically by a
-- hash of (key, seller), so a seller does not flicker in and out between calls
-- and different flags roll out to different sellers.
--
-- Flags are service-role only. Clients learn their flags from the server
-- (web: src/lib/flags.ts; mobile: /api/mobile/v1/account), never by reading
-- this table, so rollout plans are not visible to sellers.

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  country_code public.country_code references public.country_configs (country),
  seller_account_id uuid references public.seller_accounts (id) on delete cascade,
  enabled boolean not null default false,
  percentage smallint not null default 100,
  note text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_format_check check (key ~ '^[a-z][a-z0-9_:.-]{1,63}$'),
  constraint feature_flags_percentage_check check (percentage between 0 and 100),
  -- A row targets one scope. A seller row carries no country: the seller's own
  -- country is implied, and allowing both would invite contradictions.
  constraint feature_flags_scope_check check (country_code is null or seller_account_id is null)
);

comment on table public.feature_flags is
  'Rollout switches. Most specific row wins: seller, then country, then global. Service-role only.';

create unique index feature_flags_global_key on public.feature_flags (key)
  where country_code is null and seller_account_id is null;
create unique index feature_flags_country_key on public.feature_flags (key, country_code)
  where country_code is not null;
create unique index feature_flags_seller_key on public.feature_flags (key, seller_account_id)
  where seller_account_id is not null;

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from anon, authenticated;

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- Deterministic 0-99 bucket for (key, subject). hashtext is stable across
-- sessions and servers for the same input on the same major version.
create or replace function public.feature_flag_bucket(p_key text, p_subject text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select abs(hashtext(p_key || ':' || coalesce(p_subject, ''))) % 100;
$$;

create or replace function public.evaluate_feature_flag(
  p_key text,
  p_seller_account_id uuid default null,
  p_country public.country_code default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country public.country_code := p_country;
  v_row public.feature_flags;
begin
  if p_seller_account_id is not null and v_country is null then
    select country into v_country from public.seller_accounts where id = p_seller_account_id;
  end if;

  select * into v_row
    from public.feature_flags f
   where f.key = p_key
     and (
       (p_seller_account_id is not null and f.seller_account_id = p_seller_account_id)
       or (v_country is not null and f.country_code = v_country and f.seller_account_id is null)
       or (f.country_code is null and f.seller_account_id is null)
     )
   order by (f.seller_account_id is not null) desc, (f.country_code is not null) desc
   limit 1;

  if not found or not v_row.enabled then
    return false;
  end if;
  if v_row.percentage >= 100 then
    return true;
  end if;
  -- A partial rollout with no seller to bucket is off: there is no stable
  -- subject, and "on for a random 10% of anonymous calls" is never what is meant.
  if p_seller_account_id is null then
    return false;
  end if;
  return public.feature_flag_bucket(p_key, p_seller_account_id::text) < v_row.percentage;
end;
$$;

revoke all on function public.evaluate_feature_flag(text, uuid, public.country_code)
  from public, anon, authenticated;
grant execute on function public.evaluate_feature_flag(text, uuid, public.country_code)
  to service_role;
