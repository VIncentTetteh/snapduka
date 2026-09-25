-- Payment routing: which provider takes a checkout, and a circuit breaker so a
-- provider that is failing stops being offered.
--
-- Mobile money success rates in Ghana swing by network and time of day, and a
-- checkout that fails to start is a sale lost. Today every checkout goes to
-- Paystack; this adds the health record and the per-attempt route reason so a
-- second provider (Hubtel / MTN MoMo direct, pending merchant agreements) can
-- be added as data plus one adapter, and so failover is observable.
--
-- Failover only ever happens BEFORE the buyer authorises a payment. A MoMo
-- prompt that is pending on one provider is never retried on another — that is
-- how buyers get charged twice.

alter table public.payment_attempts
  add column route_reason text;

create table public.provider_health (
  provider text not null,
  country public.country_code not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  failures integer not null default 0,
  circuit_open_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider, country)
);

comment on table public.provider_health is
  'Rolling 15-minute outcome window per provider and country. A provider failing more than half of at least 10 initialisations is skipped for 10 minutes.';

alter table public.provider_health enable row level security;
alter table public.provider_health force row level security;
revoke all on public.provider_health from anon, authenticated;
grant select, insert, update on public.provider_health to service_role;

create or replace function public.record_payment_outcome(
  p_provider text,
  p_country public.country_code,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.provider_health%rowtype;
begin
  insert into public.provider_health (provider, country)
  values (p_provider, p_country)
  on conflict (provider, country) do nothing;

  select * into h from public.provider_health
   where provider = p_provider and country = p_country for update;

  if h.window_started_at < now() - interval '15 minutes' then
    h.window_started_at := now();
    h.attempts := 0;
    h.failures := 0;
  end if;
  h.attempts := h.attempts + 1;
  if not p_success then h.failures := h.failures + 1; end if;

  update public.provider_health
     set window_started_at = h.window_started_at,
         attempts = h.attempts,
         failures = h.failures,
         circuit_open_until = case
           when h.attempts >= 10 and h.failures * 2 > h.attempts then now() + interval '10 minutes'
           else circuit_open_until end,
         updated_at = now()
   where provider = p_provider and country = p_country;
end;
$$;

create or replace function public.provider_available(p_provider text, p_country public.country_code)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select circuit_open_until is null or circuit_open_until <= now()
       from public.provider_health where provider = p_provider and country = p_country),
    true);
$$;

revoke all on function public.record_payment_outcome(text, public.country_code, boolean) from public, anon, authenticated;
revoke all on function public.provider_available(text, public.country_code) from public, anon, authenticated;
grant execute on function public.record_payment_outcome(text, public.country_code, boolean) to service_role;
grant execute on function public.provider_available(text, public.country_code) to service_role;
