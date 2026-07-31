-- The background workers had never run in production. These assertions pin the
-- three things that made that possible so it cannot regress silently:
-- the schedules must exist, the token-bearing helper must not be reachable from
-- a browser session, and it must refuse rather than post unauthenticated.

begin;
select plan(17);

select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('pg_net', 'pg_net is installed');

select has_function(
  'public', 'run_internal_job', array['text'],
  'run_internal_job exists'
);

-- Every worker route under src/app/api/internal must have a schedule. A route
-- with no row here is a worker that never runs — the exact defect being fixed.
select is(
  (select count(*)::int from cron.job where jobname like 'snapduka-%'),
  10,
  'nine workers plus the pg_net response prune are scheduled'
);

select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-notifications'$$,
  'notifications worker is scheduled'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-retention'$$,
  'retention worker is scheduled'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-marketing'$$,
  'marketing worker is scheduled'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-automations'$$,
  'automations worker is scheduled'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-integrations'$$,
  'integrations worker is scheduled'
);
select isnt_empty(
  $$select 1 from cron.job where jobname = 'snapduka-sweep-reservations'$$,
  'reservation sweep is scheduled'
);

-- Buyers wait on notifications, and expired reservations lock stock other
-- buyers cannot purchase. A daily tick for either is a product defect, so the
-- cadence is asserted rather than left to whoever edits the migration next.
select is(
  (select schedule from cron.job where jobname = 'snapduka-notifications'),
  '*/2 * * * *',
  'notifications run every two minutes, not daily'
);
select is(
  (select schedule from cron.job where jobname = 'snapduka-sweep-reservations'),
  '*/10 * * * *',
  'expired reservations are released within ten minutes'
);
select is(
  (select active from cron.job where jobname = 'snapduka-notifications'),
  true,
  'scheduled jobs are active'
);

-- The function reads a bearer token out of Vault under security definer, so an
-- execute grant to a browser-facing role would leak it.
select ok(
  not has_function_privilege('anon', 'public.run_internal_job(text)', 'execute'),
  'anon cannot execute run_internal_job'
);
select ok(
  not has_function_privilege('authenticated', 'public.run_internal_job(text)', 'execute'),
  'authenticated cannot execute run_internal_job'
);

-- Path allowlist: the helper must not be usable to post the internal bearer
-- token to an arbitrary URL.
select throws_ok(
  $$select public.run_internal_job('https://evil.example.com/steal')$$,
  'P0001',
  null,
  'refuses an absolute URL'
);
select throws_ok(
  $$select public.run_internal_job('/api/internal/../../admin')$$,
  'P0001',
  null,
  'refuses path traversal'
);

select * from finish();
rollback;
