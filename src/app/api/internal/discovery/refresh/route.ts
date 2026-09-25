import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/observability/cron";

/**
 * Re-snapshots every discovery listing (quality score, active flag,
 * refreshed_at). Without this, the 30-day freshness window in the public
 * read policy silently delists shops and rankings never move. Runs daily
 * via Vercel cron; safe to invoke ad hoc with the internal job secret.
 */
async function runJob(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: refreshed, error } = await admin.rpc("refresh_discovery_listings");
  if (error) {
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
  return NextResponse.json({ refreshed: refreshed ?? 0 });
}

export const POST = withCronMonitor("snapduka-discovery-refresh", runJob, { schedule: "30 3 * * *" });
export const GET = POST;
