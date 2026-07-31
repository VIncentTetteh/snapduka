import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Moves settled order credits from pending to available once the hold elapses.
 *
 * All the decisions live in release_due_order_settlements, which re-checks each
 * order at release time — an order refunded, disputed or cancelled during the
 * hold never becomes withdrawable. That re-check is the whole reason a hold
 * exists, so it must not be duplicated here where it could drift.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_due_order_settlements");
  if (error) {
    console.error("[release-holds] failed", error.message);
    return NextResponse.json({ error: "Release failed." }, { status: 500 });
  }
  return NextResponse.json({ released: data ?? 0 });
}

export const GET = POST;
