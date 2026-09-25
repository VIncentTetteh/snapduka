import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { runSellerDigests } from "@/lib/marketing/digest";
import { withCronMonitor } from "@/lib/observability/cron";

/**
 * Seller digests (daily, and weekly on Mondays) by WhatsApp template or SMS.
 * Scheduled by pg_cron as `snapduka-seller-digest` (202609250123); gated per
 * seller by the `seller_digest` flag. Idempotent via `seller_digests`.
 */
async function run(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSellerDigests());
  } catch (error) {
    console.error("[whatsapp/digest] failed", error);
    return NextResponse.json({ error: "Digest run failed." }, { status: 500 });
  }
}

export const POST = withCronMonitor("snapduka-seller-digest", run, { schedule: "0 7 * * *" });
export const GET = POST;
