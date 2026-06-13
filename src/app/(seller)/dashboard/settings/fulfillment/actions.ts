"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { parseFulfillmentMethod } from "@/lib/fulfillment/schema";
import { createClient } from "@/lib/supabase/server";

export async function saveFulfillmentMethod(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !["pending", "active"].includes(actor.status)) return;
  const input = Object.fromEntries(["type", "name", "feeMinor", "instructions"].map((key) => [key, String(formData.get(key) ?? "")]));
  const parsed = parseFulfillmentMethod(input);
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (!shop) return;
  await supabase.from("fulfillment_methods").insert({
    shop_id: shop.id,
    seller_account_id: actor.sellerAccountId,
    type: parsed.data.type,
    name: parsed.data.name,
    fee_minor: parsed.data.feeMinor,
    instructions: parsed.data.instructions,
  });
  revalidatePath("/dashboard/settings/fulfillment");
  revalidatePath("/onboarding");
}
