import { NextResponse } from "next/server";

import { drainDomainEvents } from "@/lib/events/process";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { withCronMonitor } from "@/lib/observability/cron";

/** Drains the transactional outbox (public.domain_events). Scheduled every minute. */
async function runJob(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(await drainDomainEvents());
  } catch (error) {
    console.error("[events/process] failed", error);
    return NextResponse.json({ error: "Drain failed." }, { status: 500 });
  }
}

export const POST = withCronMonitor("domain-events-process", runJob, { schedule: "* * * * *" });
export const GET = POST;
