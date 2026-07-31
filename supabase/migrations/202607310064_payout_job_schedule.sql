-- Schedules the three ledger workers, alongside the existing entries in
-- 202607310051_job_scheduler.sql. See docs/runbooks/background-jobs.md for why
-- scheduling lives in pg_cron rather than vercel.json.

-- Daily. The hold is measured in days, so a finer tick buys nothing. Staggered
-- after snapduka-release-commissions so the two never contend.
select cron.schedule(
  'snapduka-release-holds',
  '50 3 * * *',
  $job$select public.run_internal_job('/api/internal/payouts/release-holds')$job$
);

-- Every two minutes. A seller who has asked to withdraw is watching, and this
-- worker is also the sweeper that resolves transfers we crashed midway through.
select cron.schedule(
  'snapduka-execute-payouts',
  '*/2 * * * *',
  $job$select public.run_internal_job('/api/internal/payouts/execute')$job$
);

-- Daily, before the pg_net prune so a drift investigation still has the raw
-- provider responses to look at.
select cron.schedule(
  'snapduka-reconcile-ledger',
  '10 4 * * *',
  $job$select public.run_internal_job('/api/internal/payouts/reconcile')$job$
);
