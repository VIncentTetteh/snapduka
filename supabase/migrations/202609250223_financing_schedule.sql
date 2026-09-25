-- Schedules for stock financing (ADR-0014). Two jobs:
--
-- snapduka-financing-repayments  every 5 minutes, SQL only (no worker route):
--   sweeps new hold releases into financing_payable, then moves what was swept
--   to partner_clearing. Frequent because the tick length IS the window in
--   which released money can be withdrawn before it is swept (see
--   202609250221's header); the release job itself runs daily at 03:50, so
--   in practice the gap is the few minutes after that.
--
-- snapduka-financing-settle      daily, worker route: transfers what SnapDuka
--   owes the lending partner through the partner adapter and records it. A
--   worker because it calls the partner's API; with no partner configured it
--   reports not_configured and moves nothing.
select cron.schedule(
  'snapduka-financing-repayments',
  '*/5 * * * *',
  $$select public.sweep_financing_repayments(200); select public.remit_financing_payables(200)$$
);

select cron.schedule(
  'snapduka-financing-settle',
  '25 4 * * *',
  $$select public.run_internal_job('/api/internal/financing/settle')$$
);
