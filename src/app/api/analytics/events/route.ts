import { NextResponse } from "next/server";
import { z } from "zod";

import { analyticsEventTypes } from "@/lib/analytics/events";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  id: z.uuid(), shopId: z.uuid(), sessionId: z.uuid(),
  eventType: z.enum(analyticsEventTypes), productId: z.uuid().nullable().optional(),
  source: z.string().max(100).nullable().optional(), campaign: z.string().max(100).nullable().optional(),
  country: z.enum(["GH","NG","CI"]).nullable().optional(),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!(await checkRateLimit(`analytics-events:${ip}`, { limit: 60, windowMs: 60_000 })).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const admin = createAdminClient();
  const { data: shop } = await admin.from("shops").select("seller_account_id").eq("id", parsed.data.shopId).eq("status","published").maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop unavailable." }, { status: 404 });

  // productId arrives from the browser and was written straight through, so
  // anyone could record product views for one shop against another shop's
  // product ids and skew the top-products report on a dashboard they do not
  // own. The event itself is still recorded — dropping a visit because of a bad
  // product id would lose real traffic — but the product is only attached when
  // it genuinely belongs to the shop the event is for.
  let productId: string | null = parsed.data.productId ?? null;
  if (productId) {
    const { data: product } = await admin
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("shop_id", parsed.data.shopId)
      .maybeSingle();
    if (!product) productId = null;
  }

  await admin.from("analytics_events").upsert({
    id: parsed.data.id, seller_account_id: shop.seller_account_id, shop_id: parsed.data.shopId,
    session_id: parsed.data.sessionId, event_type: parsed.data.eventType,
    product_id: productId, source: parsed.data.source, campaign: parsed.data.campaign,
    country: parsed.data.country, dimensions: {},
  }, { onConflict: "id", ignoreDuplicates: true });
  return new NextResponse(null, { status: 204 });
}
