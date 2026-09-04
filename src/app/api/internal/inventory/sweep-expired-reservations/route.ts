import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Releases stock held by checkouts that were abandoned.
 *
 * This used to select every expired `active` reservation and release it, with
 * no regard for the order behind it. finalize_order_stock only consumes
 * reservations that are still `active`, so once this had run there was nothing
 * left to consume: a seller marking an order complete, or a mobile-money
 * payment landing after the 30-minute window, decremented no stock at all.
 * Production had four released reservations belonging to `completed` orders,
 * three of them paid.
 *
 * The decision now lives in release_abandoned_reservations, next to the data:
 * it releases only where the order is gone, cancelled, or still unconfirmed and
 * unpaid, and holds anything paid, offline_due, or taken on by the seller.
 * `offline_due` is the case that matters here — a cash-on-delivery order is
 * unpaid for days by design.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_abandoned_reservations", { p_limit: 200 });

  if (error) {
    // A sweep that cannot run is not a quiet no-op: stock stays held for
    // abandoned checkouts until someone notices.
    console.error("[sweep-reservations] sweep failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Sweep failed.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ released: data?.length ?? 0 });
}

export const GET = POST;
