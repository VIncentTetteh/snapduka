// No direct `import "server-only"`: this module is already server-only through
// @/lib/internal-jobs/auth, and a direct import would break every existing
// route test that mocks that module but not "server-only".
import * as Sentry from "@sentry/nextjs";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";

/**
 * Sentry Cron Monitor check-ins for the pg_cron-driven workers.
 *
 * Why this exists: every /api/internal/** worker is fired by pg_cron through
 * pg_net (`public.run_internal_job`). pg_net is fire-and-forget, so when a
 * worker 401s (the Vault secret drifted), 500s, or simply stops being called,
 * nothing notices. That has happened (see docs/runbooks/background-jobs.md).
 * A cron monitor alerts on both halves: a check-in that reports `error`, and a
 * check-in that never arrives on schedule.
 *
 * Adopting it in a new worker is one line. Keep the handler as a plain function
 * and export the wrapped one; use the pg_cron job name as the slug so the
 * Sentry monitor and the `cron.job` row are obviously the same thing, and copy
 * the crontab from the migration that schedules it:
 *
 * ```ts
 * async function run(request: Request) { ...existing handler body... }
 *
 * export const POST = withCronMonitor("snapduka-my-job", run, { schedule: "*\/5 * * * *" });
 * export const GET = POST;
 * ```
 *
 * Behaviour:
 * - No Sentry client (no DSN: local, tests, CI) -> the handler runs untouched.
 * - Unauthenticated callers never check in. Otherwise anyone who can reach the
 *   URL could mark the monitor healthy, or flap it, without running the job;
 *   the handler still runs and returns its own 401.
 * - A thrown error or a 5xx response is `error`; anything else is `ok`. The
 *   error is rethrown unchanged so Next's onRequestError still captures it.
 * - The check-in is flushed before returning: a serverless function can be
 *   frozen the moment it responds, and a buffered `ok` that never leaves looks
 *   exactly like a missed run.
 */

export type CronMonitorOptions = {
  /** Crontab the job runs on (UTC, as pg_cron schedules). Upserts the monitor. */
  schedule?: string;
  /** Minutes after the expected time before a missing check-in alerts. */
  checkinMarginMinutes?: number;
  /** Minutes an in_progress check-in may run before it is marked timed out. */
  maxRuntimeMinutes?: number;
};

const DEFAULT_CHECKIN_MARGIN_MINUTES = 5;
const DEFAULT_MAX_RUNTIME_MINUTES = 10;
const FLUSH_TIMEOUT_MS = 2000;
const SERVER_ERROR_STATUS = 500;
const MS_PER_SECOND = 1000;

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

function monitorConfig(options: CronMonitorOptions): MonitorConfig | undefined {
  if (!options.schedule) return undefined;
  return {
    schedule: { type: "crontab", value: options.schedule },
    timezone: "UTC",
    checkinMargin: options.checkinMarginMinutes ?? DEFAULT_CHECKIN_MARGIN_MINUTES,
    maxRuntime: options.maxRuntimeMinutes ?? DEFAULT_MAX_RUNTIME_MINUTES,
  };
}

/** Wrap an internal worker route handler with Sentry cron check-ins. */
export function withCronMonitor<Rest extends unknown[]>(
  slug: string,
  handler: (request: Request, ...rest: Rest) => Promise<Response>,
  options: CronMonitorOptions = {},
): (request: Request, ...rest: Rest) => Promise<Response> {
  return async function monitored(request: Request, ...rest: Rest): Promise<Response> {
    if (!Sentry.getClient() || !isInternalJobRequest(request)) {
      return handler(request, ...rest);
    }

    const startedAt = Date.now();
    const checkInId = Sentry.captureCheckIn(
      { monitorSlug: slug, status: "in_progress" },
      monitorConfig(options),
    );
    const finish = async (status: "ok" | "error") => {
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: slug,
        status,
        duration: (Date.now() - startedAt) / MS_PER_SECOND,
      });
      await Sentry.flush(FLUSH_TIMEOUT_MS);
    };

    try {
      const response = await handler(request, ...rest);
      await finish(response.status >= SERVER_ERROR_STATUS ? "error" : "ok");
      return response;
    } catch (error) {
      await finish("error");
      throw error;
    }
  };
}
