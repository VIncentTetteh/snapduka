import { NextResponse } from "next/server";
import { z } from "zod";

import { deriveAvailability } from "@/lib/catalog/inventory";
import { calculateQuote } from "@/lib/commerce/quote";
import { calculateDiscount } from "@/lib/promotions/discounts";
import { createAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  lines: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive().max(99) })).min(1),
  promotionCode: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quote request." }, { status: 400 });

  const supabase = createAdminClient();
  const productIds = parsed.data.lines.map((line) => line.productId);
  const [{ data: products }, { data: method }, { data: promotion }] = await Promise.all([
    supabase.from("products").select("id, shop_id, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity").eq("shop_id", parsed.data.shopId).in("id", productIds),
    supabase.from("fulfillment_methods").select("id, shop_id, fee_minor, active").eq("id", parsed.data.fulfillmentMethodId).eq("shop_id", parsed.data.shopId).eq("active", true).maybeSingle(),
    parsed.data.promotionCode ? supabase.from("promotions").select("kind,value,minimum_minor,maximum_minor").eq("shop_id", parsed.data.shopId).eq("code", parsed.data.promotionCode.trim().toUpperCase()).eq("active", true).maybeSingle() : Promise.resolve({ data: null }),
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
    const discountMinor = promotion ? calculateDiscount({ kind: promotion.kind, value: promotion.value, minimumMinor: promotion.minimum_minor, maximumMinor: promotion.maximum_minor ?? undefined }, quote.subtotalMinor) : 0;
    return NextResponse.json({ ...quote, discountMinor, totalMinor: quote.totalMinor - discountMinor, currency: products?.[0]?.currency, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Quote failed." }, { status: 409 });
  }
}
