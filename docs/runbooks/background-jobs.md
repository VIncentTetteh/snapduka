# Background jobs

Twelve worker routes live under `src/app/api/internal/**`. They are **scheduled by
pg_cron inside Supabase, not by Vercel.** `vercel.json` deliberately declares no
`crons` array — do not add one back without removing the matching pg_cron entry,
or the worker will run twice.

## Why not Vercel cron

The project is on a Vercel **Hobby** plan, which allows **2 cron jobs, daily
only**. `vercel.json` previously declared 4, so none of them registered.
Separately, `CRON_SECRET` was never set, so Vercel's cron requests carried no
`Authorization` header and `isInternalJobRequest()` rejected them with a 401.

The result: **no background worker had ever run in production.** 42 notifications
sat unsent (oldest 2026-06-14), 6 expired stock reservations were still holding
stock, and every queue read `ever_processed = 0`.

pg_cron has no per-plan job limit, runs at whatever cadence each job actually
needs, and lives in a migration alongside the schema.

## Schedule

Defined in `supabase/migrations/202607310051_job_scheduler.sql` and
`202607310064_payout_job_schedule.sql`.

| Job | Cadence | Why |
|---|---|---|
| `snapduka-notifications` | every 2 min | A buyer is waiting on it |
| `snapduka-sweep-reservations` | every 10 min | Expired reservations lock stock nobody can buy |
| `snapduka-integrations` | every 5 min | Honours webhook `next_attempt_at` backoff |
| `snapduka-automations` | every 5 min | Seller-defined rules should feel immediate |
| `snapduka-marketing` | every 15 min | Bounds drift past the seller's chosen send time |
| `snapduka-retention` | hourly | `remind_after` already encodes the delay |
| `snapduka-apply-plan-changes` | 03:15 daily | Acts on period boundaries |
| `snapduka-discovery-refresh` | 03:30 daily | Ranking, not time-critical |
| `snapduka-release-commissions` | 03:45 daily | Hold window is measured in days |
| `snapduka-release-holds` | 03:50 daily | The hold is measured in days |
| `snapduka-reconcile-ledger` | 04:10 daily | Before the prune, so drift still has raw responses to inspect |
| `snapduka-prune-http-responses` | 04:20 daily | `net._http_response` is never pruned by pg_net |
| `snapduka-execute-payouts` | every 2 min | A seller who asked to withdraw is watching; also the sweeper for crashed transfers |

## Authentication

`public.run_internal_job(path)` posts to the worker with a bearer token. Both the
token and the base URL are held in **Supabase Vault** (`internal_job_secret`,
`app_base_url`), never in the migration — it is committed to git.

The function is `security definer` and reads that token, so `execute` is revoked
from `public`, `anon` and `authenticated`. It also allowlists the path
(`^/api/internal/[a-z0-9/-]+$`) so it can never be used to post the token to an
arbitrary host. `supabase/tests/database/027_job_scheduler.test.sql` pins all of
this.

**The Vault token and Vercel's `INTERNAL_JOB_SECRET` must be identical.** They
drifted once already: production held an 11-character secret while local dev held
a 64-character one. To rotate, write both sides from a single generated value and
redeploy — Vercel only picks up an env change on deploy.

## Diagnosis

Did a job fire, and did the request succeed?

```sql
-- last 20 runs, and whether pg_cron itself errored
select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r join cron.job j using (jobid)
where j.jobname like 'snapduka-%'
order by r.start_time desc limit 20;

-- what the app actually returned (401 here means the secrets have drifted)
select (r.headers->>'date') as at, r.status_code, r.content
from net._http_response r order by r.id desc limit 20;
```

Queue depth — every one of these should trend to zero:

```sql
select 'notifications' q, count(*) from public.notifications where status in ('pending','failed')
union all select 'reservations', count(*) from public.stock_reservations where expires_at < now() and status = 'active'
union all select 'webhooks', count(*) from public.webhook_deliveries where state in ('queued','retry')
union all select 'automations', count(*) from public.automation_runs where state = 'pending';
```

A queue that only grows means the workers are 401ing. Check
`net._http_response.status_code` first — that distinguishes "never fired" from
"fired and was rejected", which is exactly the distinction that was missing when
this went unnoticed for seven weeks.

## Pausing

```sql
update cron.job set active = false where jobname = 'snapduka-marketing';
```

Prefer this over unscheduling: the row, its cadence and its command survive, so
re-enabling is a one-word change rather than a guess at the original schedule.
