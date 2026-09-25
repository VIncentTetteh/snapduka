import { NextResponse } from "next/server";

import { settleWithPartners } from "@/lib/financing/service";
import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { withCronMonitor } from "@/lib/observability/cron";

/**
 * Daily (pg_cron snapduka-financing-settle, 202609250223): pays each lending
 * partner what SnapDuka has swept and remitted for them, then records the
 * transfer. Sweeping and remitting themselves are SQL-only and run every five
 * minutes; this is only the cash leg, because it calls the partner.
 */
async function runJob(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const outcomes = await settleWithPartners();
    const failed = outcomes.some((outcome) => outcome.status === "failed" || outcome.status === "ambiguous_partner");
    return NextResponse.json({ outcomes }, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error("[financing/settle] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Settlement failed." }, { status: 500 });
  }
}

export const POST = withCronMonitor("snapduka-financing-settle", runJob, { schedule: "25 4 * * *" });
export const GET = POST;
