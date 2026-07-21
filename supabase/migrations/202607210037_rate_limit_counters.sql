-- supabase/migrations/202607210037_rate_limit_counters.sql
-- Replaces the app's in-memory rate limiter (a bare process-local Map,
-- which resets per Vercel serverless instance and provides no real
-- protection under concurrent load) with a Postgres-backed counter shared
-- across every instance.

create table public.rate_limit_counters (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_counters force row level security;

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_ms bigint)
returns table(allowed boolean, retry_after_ms bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := clock_timestamp();
  row_record public.rate_limit_counters%rowtype;
begin
  insert into public.rate_limit_counters (key, count, reset_at)
  values (p_key, 1, now_ts + (p_window_ms::text || ' milliseconds')::interval)
  on conflict (key) do update set
    count = case when public.rate_limit_counters.reset_at <= now_ts then 1 else public.rate_limit_counters.count + 1 end,
    reset_at = case when public.rate_limit_counters.reset_at <= now_ts then now_ts + (p_window_ms::text || ' milliseconds')::interval else public.rate_limit_counters.reset_at end
  returning * into row_record;

  if row_record.count > p_limit then
    return query select false, greatest(0, extract(epoch from (row_record.reset_at - now_ts)) * 1000)::bigint;
  else
    return query select true, 0::bigint;
  end if;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, bigint) to service_role;
