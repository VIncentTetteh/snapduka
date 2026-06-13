import { NextResponse } from "next/server";
import { z } from "zod";

import { deriveAvailability } from "@/lib/catalog/inventory";
import { calculateQuote } from "@/lib/commerce/quote";
import { createAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  lines: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive().max(99) })).min(1),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quote request." }, { status: 400 });

  const supabase = createAdminClient();
  const productIds = parsed.data.lines.map((line) => line.productId);
  const [{ data: products }, { data: method }] = await Promise.all([
    supabase.from("products").select("id, shop_id, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity").eq("shop_id", parsed.data.shopId).in("id", productIds),
    supabase.from("fulfillment_methods").select("id, shop_id, fee_minor, active").eq("id", parsed.data.fulfillmentMethodId).eq("shop_id", parsed.data.shopId).eq("active", true).maybeSingle(),
  ]);
  if (!method || products?.length !== productIds.length) {
    return NextResponse.json({ error: "Products or fulfillment changed. Refresh and try again." }, { status: 409 });
  }

  try {
    const quote = calculateQuote(
      parsed.data.lines,
      (products ?? []).map((product) => ({
        productId: product.id,
        priceMinor: product.price_minor,
        available:
          product.status === "active" &&
          deriveAvailability({ policy: product.inventory_policy, stock: product.stock_quantity, reserved: product.reserved_quantity }) !== "sold_out",
      })),
      method.fee_minor,
    );
    return NextResponse.json({ ...quote, currency: products?.[0]?.currency, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Quote failed." }, { status: 409 });
  }
}
