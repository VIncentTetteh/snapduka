-- Actually runs the background workers.
--
-- Nine worker routes exist under /api/internal/**. Not one had ever run in
-- production. Every queue read ever_processed = 0: 42 notifications never sent
-- (order confirmations and status updates buyers never received), 6 stock
-- reservations expired but never released, 3 abandoned-cart reminders due.
--
-- Two independent causes, both outside the application code:
--
--   1. vercel.json declared 4 crons on a Hobby plan, which allows 2. The
--      schedules were never registered.
--   2. CRON_SECRET was never set, so Vercel's cron requests carried no
--      Authorization header and isInternalJobRequest() 401'd them. Verified by
--      probing the live endpoint.
--
-- Scheduling therefore moves to pg_cron here, where it is version-controlled
-- like the rest of the schema, has no per-plan job limit, and can run each
-- worker at a frequency that actually suits it — a daily tick would deliver an
-- order confirmation up to 24 hours late.
--
-- vercel.json's crons array is emptied in the same change so nothing is
-- scheduled twice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret and base URL live in Supabase Vault, never in this file: this
-- migration is committed to git. They are seeded out-of-band with
-- vault.create_secret(); run_internal_job raises if either is missing rather
-- than quietly posting an unauthenticated request that would 401 forever —
-- which is precisely the failure being fixed.
create or replace function public.run_internal_job(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_path !~ '^/api/internal/[a-z0-9/-]+$' then
    raise exception 'run_internal_job: refusing to post to %', p_path;
  end if;

  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'internal_job_secret';

  if v_base_url is null or v_secret is null then
    raise exception
      'run_internal_job: app_base_url or internal_job_secret is missing from vault';
  end if;

  -- pg_net is fire-and-forget: this returns once the request is queued, not
  -- once the worker finishes. That is what we want — the workers are already
  -- idempotent (each claims its rows with a conditional update), so a slow run
  -- overlapping the next tick is safe, and nothing here needs the response.
  select net.http_post(
    url := rtrim(v_base_url, '/') || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.run_internal_job(text) is
  'Posts to an /api/internal worker with the Vault-held bearer token. Called only by pg_cron; the token must never reach a client, so execute is service_role-only.';

-- The function is security definer and reads a bearer token out of Vault, so
-- execute must not be reachable from a browser session under any role.
revoke all on function public.run_internal_job(text) from public;
revoke all on function public.run_internal_job(text) from anon;
revoke all on function public.run_internal_job(text) from authenticated;

-- Frequencies are set by how stale the work is allowed to get, not by
-- convenience. cron.schedule upserts on job name, so re-running is safe.

-- Buyers are waiting on these. Anything slower reads as a broken shop.
select cron.schedule(
  'snapduka-notifications',
  '*/2 * * * *',
  $job$select public.run_internal_job('/api/internal/notifications/process')$job$
);

-- Expired reservations hold stock that other buyers cannot purchase. The old
-- daily schedule (which never ran) would have left stock locked for a day.
select cron.schedule(
  'snapduka-sweep-reservations',
  '*/10 * * * *',
  $job$select public.run_internal_job('/api/internal/inventory/sweep-expired-reservations')$job$
);

-- Outbound webhooks carry their own exponential backoff via next_attempt_at;
-- this only needs to tick often enough to honour it.
select cron.schedule(
  'snapduka-integrations',
  '*/5 * * * *',
  $job$select public.run_internal_job('/api/internal/integrations/process')$job$
);

select cron.schedule(
  'snapduka-automations',
  '*/5 * * * *',
  $job$select public.run_internal_job('/api/internal/automations/process')$job$
);

-- Sellers pick a send time for a broadcast, so the tick sets how far past that
-- time it can drift.
select cron.schedule(
  'snapduka-marketing',
  '*/15 * * * *',
  $job$select public.run_internal_job('/api/internal/marketing/process')$job$
);

-- Abandoned-cart reminders and restock alerts. remind_after already encodes
-- the delay, so hourly is close enough without pestering anyone.
select cron.schedule(
  'snapduka-retention',
  '0 * * * *',
  $job$select public.run_internal_job('/api/internal/retention/process')$job$
);

-- Daily is correct for these three: all act on period boundaries or hold
-- windows measured in days. Times are staggered so they never contend.
select cron.schedule(
  'snapduka-apply-plan-changes',
  '15 3 * * *',
  $job$select public.run_internal_job('/api/internal/billing/apply-plan-changes')$job$
);

select cron.schedule(
  'snapduka-discovery-refresh',
  '30 3 * * *',
  $job$select public.run_internal_job('/api/internal/discovery/refresh')$job$
);

select cron.schedule(
  'snapduka-release-commissions',
  '45 3 * * *',
  $job$select public.run_internal_job('/api/internal/creators/release-commissions')$job$
);

-- pg_net records every response in net._http_response and does not prune on
-- its own. At these frequencies that is ~25k rows a day, so it would become
-- the largest table in the database within a month.
select cron.schedule(
  'snapduka-prune-http-responses',
  '20 4 * * *',
  $job$delete from net._http_response where created < now() - interval '3 days'$job$
);
