import { NextResponse } from "next/server";
import { z } from "zod";

import { analyticsEventTypes } from "@/lib/analytics/events";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  id: z.uuid(), shopId: z.uuid(), sessionId: z.uuid(),
  eventType: z.enum(analyticsEventTypes), productId: z.uuid().nullable().optional(),
  source: z.string().max(100).nullable().optional(), campaign: z.string().max(100).nullable().optional(),
  country: z.enum(["GH","NG"]).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const admin = createAdminClient();
  const { data: shop } = await admin.from("shops").select("seller_account_id").eq("id", parsed.data.shopId).eq("status","published").maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop unavailable." }, { status: 404 });
  await admin.from("analytics_events").upsert({
    id: parsed.data.id, seller_account_id: shop.seller_account_id, shop_id: parsed.data.shopId,
    session_id: parsed.data.sessionId, event_type: parsed.data.eventType,
    product_id: parsed.data.productId, source: parsed.data.source, campaign: parsed.data.campaign,
    country: parsed.data.country, dimensions: {},
  }, { onConflict: "id", ignoreDuplicates: true });
  return new NextResponse(null, { status: 204 });
}
