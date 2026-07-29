import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Moves creator commissions from `pending` to `payable` once their hold window
 * has elapsed.
 *
 * The hold exists so a refund lands before the seller pays out, not after —
 * reversing a paid commission means chasing money back from a creator, which
 * is the one part of this system SnapDuka cannot help with. The SQL function
 * re-checks the order at release time (still paid, unrefunded, undisputed), so
 * an order that soured during the hold never becomes payable.
 *
 * Runs daily via Vercel cron; safe to invoke ad hoc with the internal job
 * secret, and safe to run twice — releasing an already-released commission
 * matches nothing.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: released, error } = await admin.rpc("release_due_creator_commissions");
  if (error) {
    console.error("[release-commissions] release failed", error.message);
    return NextResponse.json({ error: "Release failed." }, { status: 500 });
  }
  return NextResponse.json({ released: released ?? 0 });
}

export const GET = POST;
