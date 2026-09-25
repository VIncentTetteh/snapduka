import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { withCronMonitor } from "@/lib/observability/cron";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Protect clock (every 5 minutes): confirms deliveries whose timeout has
 * passed and flags paid orders that were never dispatched. The rules live in
 * protect_sweep (202609250107), not here.
 */
async function runJob(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("protect_sweep", { p_batch: 200 });
  if (error) {
    console.error("[protect/sweep] failed", error.message);
    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const POST = withCronMonitor("snapduka-protect-sweep", runJob, { schedule: "*/5 * * * *" });
export const GET = POST;
