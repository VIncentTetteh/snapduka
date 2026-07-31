import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: expired } = await admin
    .from("stock_reservations")
    .select("id")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .limit(200);
  let released = 0;
  const failures: string[] = [];
  for (const row of expired ?? []) {
    const { error } = await admin.rpc("finish_stock_reservation", { p_reservation_id: row.id, p_outcome: "released" });
    if (error) {
      // A reservation that cannot be released is re-selected on every run and
      // fails on every run. Counting only successes made that invisible: the
      // response read "released 0, processed 2" indefinitely with no clue why.
      // Two rows sat like this from 2026-07-28 until the worker was first
      // scheduled and the failure finally had somewhere to show up.
      failures.push(`${row.id}: ${error.message}`);
      console.error(`[sweep-reservations] could not release ${row.id}: ${error.message}`, {
        code: error.code,
      });
      continue;
    }
    released++;
  }
  return NextResponse.json({
    released,
    processed: expired?.length ?? 0,
    ...(failures.length ? { failed: failures.length, failures } : {}),
  });
}

export const GET = POST;
