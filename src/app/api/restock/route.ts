import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  consent: z.literal(true),
  email: z.email().optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  productId: z.uuid(),
}).refine((value) => value.email || value.phone);

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(`restock:${ip}`, { limit: 10, windowMs: 10 * 60_000 }).ok) return NextResponse.json({ error: "Too many requests. Please try later." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email or international phone number and accept the alert." }, { status: 400 });
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("seller_account_id,shops!inner(status)").eq("id", parsed.data.productId).eq("status", "active").eq("shops.status", "published").maybeSingle();
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  let existing = null;
  if (parsed.data.email) {
    ({ data: existing } = await admin.from("restock_requests").select("id").eq("product_id", parsed.data.productId).eq("email", parsed.data.email).is("notified_at", null).maybeSingle());
  } else if (parsed.data.phone) {
    ({ data: existing } = await admin.from("restock_requests").select("id").eq("product_id", parsed.data.productId).eq("phone", parsed.data.phone).is("notified_at", null).maybeSingle());
  }
  if (!existing) {
    const { error } = await admin.from("restock_requests").insert({ consent: true, email: parsed.data.email ?? null, phone: parsed.data.phone ?? null, product_id: parsed.data.productId, seller_account_id: product.seller_account_id });
    if (error) return NextResponse.json({ error: "Unable to save request." }, { status: 500 });
  }
  return NextResponse.json({ saved: true }, { status: 201 });
}
