import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ campaignToken: z.string().max(64).optional(), cart: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(50), consent: z.literal(true), contact: z.email(), shopId: z.uuid() });

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(`abandoned:${ip}`, { limit: 10, windowMs: 10 * 60_000 }).ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid recovery request." }, { status: 400 });
  const admin = createAdminClient();
  const { data: shop } = await admin.from("shops").select("seller_account_id").eq("id", parsed.data.shopId).eq("status", "published").maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });
  const productIds = [...new Set(parsed.data.cart.map((line) => line.productId))];
  const { data: products } = await admin.from("products").select("id").eq("shop_id", parsed.data.shopId).eq("status", "active").in("id", productIds);
  if (products?.length !== productIds.length) return NextResponse.json({ error: "Cart contains unavailable products." }, { status: 400 });
  const { error } = await admin.from("abandoned_checkouts").insert({ campaign_token: parsed.data.campaignToken ?? null, cart_snapshot: parsed.data.cart, consent: true, contact: parsed.data.contact.toLowerCase(), remind_after: new Date(Date.now() + 3_600_000).toISOString(), seller_account_id: shop.seller_account_id, shop_id: parsed.data.shopId });
  return error ? NextResponse.json({ error: "Unable to save recovery preference." }, { status: 500 }) : NextResponse.json({ saved: true }, { status: 201 });
}
