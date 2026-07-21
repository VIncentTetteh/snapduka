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
  for (const row of expired ?? []) {
    const { error } = await admin.rpc("finish_stock_reservation", { p_reservation_id: row.id, p_outcome: "released" });
    if (!error) released++;
  }
  return NextResponse.json({ released, processed: expired?.length ?? 0 });
}

export const GET = POST;
