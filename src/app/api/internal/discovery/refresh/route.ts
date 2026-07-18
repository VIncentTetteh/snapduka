import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Re-snapshots every discovery listing (quality score, active flag,
 * refreshed_at). Without this, the 30-day freshness window in the public
 * read policy silently delists shops and rankings never move. Runs daily
 * via Vercel cron; safe to invoke ad hoc with the internal job secret.
 */
export async function POST(request: Request) {
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

export const GET = POST;
