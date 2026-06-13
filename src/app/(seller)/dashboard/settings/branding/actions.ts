"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { normalizeHostname } from "@/lib/domains/verification";
import { parseBranding } from "@/lib/shops/branding";
import { createClient } from "@/lib/supabase/server";

export async function saveBranding(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const parsed = parseBranding({ accent: formData.get("accent"), surface: formData.get("surface"), font: formData.get("font") });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (!shop) return;
  await supabase.from("shop_branding").upsert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, accent_color: parsed.data.accent, surface_color: parsed.data.surface, font_family: parsed.data.font });
  revalidatePath("/dashboard/settings/branding");
  revalidatePath(`/${shop.id}`);
}

export async function addCustomDomain(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const hostname = normalizeHostname(String(formData.get("hostname") ?? ""));
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (shop) await supabase.from("custom_domains").insert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, hostname });
  revalidatePath("/dashboard/settings/branding");
}
