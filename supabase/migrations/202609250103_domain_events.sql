-- Transactional outbox: domain events written in the same transaction as the
-- state change they describe.
--
-- Until now, side effects of a state change (buyer notification, integration
-- webhook, analytics) were fired from TypeScript *after* the change committed,
-- by whichever route happened to make it. Every route that forgot — the public
-- fulfilment API, the courier webhook — left the buyer uninformed, and there
-- was no way to find out afterwards. Protect makes this sharper: a delivery code
-- that is issued but never sent strands the buyer's money.
--
-- An event inserted inside the same transaction as the change is either
-- committed with it or not at all. A worker then delivers each event at least
-- once; handlers must therefore be idempotent (the notification and ledger
-- paths already key on event ids).
--
-- A plain table claimed with `for update skip locked` rather than pgmq: it needs
-- no extension, is visible to the same pgTAP tests as the rest of the schema,
-- and the volume (one event per state change) is far below where that matters.
-- This replaces financial_events, which was written but never read.

create table public.domain_events (
  id bigint generated always as identity primary key,
  aggregate text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Deduplicates re-emission of the same fact (e.g. a replayed webhook).
  dedupe_key text,
  occurred_at timestamptz not null default now(),
  attempts smallint not null default 0,
  claimed_until timestamptz,
  processed_at timestamptz,
  last_error text,
  constraint domain_events_aggregate_check check (aggregate ~ '^[a-z_]{2,40}$'),
  constraint domain_events_type_check check (event_type ~ '^[a-z_]+\.[a-z_.]+$')
);

comment on table public.domain_events is
  'Transactional outbox. Written by definer RPCs in the same transaction as the change; drained by /api/internal/events/process.';

create unique index domain_events_dedupe_key on public.domain_events (dedupe_key)
  where dedupe_key is not null;
create index domain_events_pending on public.domain_events (id)
  where processed_at is null;
create index domain_events_aggregate on public.domain_events (aggregate, aggregate_id, id);

alter table public.domain_events enable row level security;
alter table public.domain_events force row level security;
revoke all on public.domain_events from anon, authenticated;

create or replace function public.emit_domain_event(
  p_aggregate text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.domain_events (aggregate, aggregate_id, event_type, payload, dedupe_key)
  values (p_aggregate, p_aggregate_id, p_event_type, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Claim a bounded batch. Bounded explicitly: an unbounded select here is capped
-- at db.max_rows (1000) by PostgREST without any error, which is how three
-- dashboards once reported wrong numbers.
create or replace function public.claim_domain_events(
  p_batch integer default 50,
  p_lease_seconds integer default 120
)
returns setof public.domain_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.domain_events e
     set claimed_until = now() + make_interval(secs => p_lease_seconds),
         attempts = e.attempts + 1
   where e.id in (
     select id from public.domain_events
      where processed_at is null
        and (claimed_until is null or claimed_until < now())
        and attempts < 10
      order by id
      limit least(greatest(p_batch, 1), 200)
      for update skip locked
   )
  returning e.*;
end;
$$;

create or replace function public.complete_domain_event(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.domain_events
     set processed_at = case when p_error is null then now() else processed_at end,
         last_error = p_error,
         -- A failed event becomes claimable again once its lease is released.
         claimed_until = case when p_error is null then claimed_until else null end
   where id = p_id;
$$;

revoke all on function public.emit_domain_event(text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_domain_events(integer, integer) from public, anon, authenticated;
revoke all on function public.complete_domain_event(bigint, text) from public, anon, authenticated;
grant execute on function public.emit_domain_event(text, uuid, text, jsonb, text) to service_role;
grant execute on function public.claim_domain_events(integer, integer) to service_role;
grant execute on function public.complete_domain_event(bigint, text) to service_role;

-- Drained every minute; producers that need lower latency kick the worker
-- directly after committing.
select cron.schedule(
  'snapduka-domain-events',
  '* * * * *',
  $$select public.run_internal_job('/api/internal/events/process')$$
);
