import { NextResponse } from "next/server";
import { z } from "zod";

import { isFeatureEnabled } from "@/lib/flags";
import { setOrderProtection } from "@/lib/protect/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Buyer opts an unpaid order in or out of SnapDuka Protect, before paying.
 *
 * Authorised by the tracking token (the buyer's capability for this order).
 * The SQL decides eligibility — market switch, seller on ledger settlement,
 * order limit, float cap, no payment started — and returns buyer-safe
 * messages; this route adds the rollout flag and a rate limit.
 */
const schema = z.object({ enabled: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const limited = await checkRateLimit(`protect:optin:${token}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data: order } = await createAdminClient()
    .from("orders")
    .select("id,seller_account_id")
    .eq("tracking_token", token)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  if (parsed.data.enabled && !(await isFeatureEnabled("protect", { sellerAccountId: order.seller_account_id }))) {
    return NextResponse.json({ error: "This shop does not offer Protect yet." }, { status: 409 });
  }

  const result = await setOrderProtection(order.id, token, parsed.data.enabled);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({
    protectionMode: result.protectionMode,
    protectFeeMinor: result.protectFeeMinor,
    totalMinor: result.totalMinor,
  });
}
