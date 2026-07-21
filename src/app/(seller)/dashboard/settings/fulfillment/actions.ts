"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { parseFulfillmentMethod } from "@/lib/fulfillment/schema";
import { createClient } from "@/lib/supabase/server";

export async function saveFulfillmentMethod(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) return;
  const input = Object.fromEntries(["type", "name", "feeMinor", "instructions"].map((key) => [key, String(formData.get(key) ?? "")]));
  const parsed = parseFulfillmentMethod(input);
  if (!parsed.success) {
    console.error("[saveFulfillmentMethod] validation failed", parsed.fieldErrors);
    return;
  }
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (!shop) {
    console.error("[saveFulfillmentMethod] shop not found for seller", actor.sellerAccountId);
    return;
  }
  const { error } = await supabase.from("fulfillment_methods").insert({
    shop_id: shop.id,
    seller_account_id: actor.sellerAccountId,
    type: parsed.data.type,
    name: parsed.data.name,
    fee_minor: parsed.data.feeMinor,
    instructions: parsed.data.instructions,
  });
  if (error) {
    console.error("[saveFulfillmentMethod] insert failed", error);
    return;
  }
  revalidatePath("/dashboard/settings/fulfillment");
  revalidatePath("/onboarding");
}

export async function updateFulfillmentFee(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) return;
  const methodId = String(formData.get("methodId") ?? "");
  const fee = String(formData.get("feeMinor") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!methodId || !/^\d+$/.test(fee) || name.length < 2) return;
  const supabase = await createClient();
  await supabase
    .from("fulfillment_methods")
    .update({ fee_minor: Number(fee), name })
    .eq("id", methodId)
    .eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/fulfillment");
}

export async function toggleFulfillmentMethod(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) return;
  const methodId = String(formData.get("methodId") ?? "");
  const active = formData.get("active") === "true";
  if (!methodId) return;
  const supabase = await createClient();
  await supabase
    .from("fulfillment_methods")
    .update({ active })
    .eq("id", methodId)
    .eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/fulfillment");
}
