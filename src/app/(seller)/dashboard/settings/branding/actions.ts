"use server";

import { revalidatePath } from "next/cache";
import { resolveTxt } from "node:dns/promises";

import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { normalizeHostname } from "@/lib/domains/verification";
import { parseBranding } from "@/lib/shops/branding";
import { createClient } from "@/lib/supabase/server";

export async function saveBranding(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  // Theme customization is a paid capability; the shop logo stays free.
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "branding")) return;
  const parsed = parseBranding({ accent: formData.get("accent"), surface: formData.get("surface"), font: formData.get("font") });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (!shop) return;
  await supabase.from("shop_branding").upsert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, accent_color: parsed.data.accent, surface_color: parsed.data.surface, font_family: parsed.data.font });
  revalidatePath("/dashboard/settings/branding");
  revalidatePath(`/${shop.id}`);
}

export async function uploadShopLogoAction(
  dataUrl: string,
  dimensions: { height: number; width: number },
): Promise<{ success: boolean; message: string }> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !["pending", "active"].includes(actor.status)) {
    return { success: false, message: "Sign in with an active seller account." };
  }

  const base64 = dataUrl.split(",")[1];
  if (!base64 || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 1000 || dimensions.height > 1000) {
    return { success: false, message: "Invalid image data." };
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) return { success: false, message: "Create your shop first." };

  const buffer = Buffer.from(base64, "base64");
  // Unique path per upload so cached copies of the old logo never linger.
  const objectPath = `${actor.sellerAccountId}/logo-${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("shop-logos")
    .upload(objectPath, buffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    return { success: false, message: "Logo upload failed. Please try again." };
  }

  const { data: previous } = await supabase
    .from("shop_branding")
    .select("logo_path")
    .eq("shop_id", shop.id)
    .maybeSingle();

  const { error: brandingError } = await supabase
    .from("shop_branding")
    .upsert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, logo_path: objectPath });
  if (brandingError) {
    await supabase.storage.from("shop-logos").remove([objectPath]);
    return { success: false, message: "Logo could not be saved. Please try again." };
  }

  if (previous?.logo_path && previous.logo_path !== objectPath) {
    await supabase.storage.from("shop-logos").remove([previous.logo_path]);
  }

  revalidatePath("/dashboard/settings/branding");
  revalidatePath(`/${shop.slug}`);
  return { success: true, message: "Logo saved." };
}

export async function removeShopLogoAction(): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) return;
  const { data: branding } = await supabase
    .from("shop_branding")
    .select("logo_path")
    .eq("shop_id", shop.id)
    .maybeSingle();
  if (!branding?.logo_path) return;
  await supabase.from("shop_branding").update({ logo_path: null }).eq("shop_id", shop.id);
  await supabase.storage.from("shop-logos").remove([branding.logo_path]);
  revalidatePath("/dashboard/settings/branding");
  revalidatePath(`/${shop.slug}`);
}

export async function addCustomDomain(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "customDomain")) return;
  const hostname = normalizeHostname(String(formData.get("hostname") ?? ""));
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("seller_account_id", actor.sellerAccountId).single();
  if (shop) await supabase.from("custom_domains").insert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, hostname });
  revalidatePath("/dashboard/settings/branding");
}

export async function verifyCustomDomain(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const domainId = String(formData.get("domainId") ?? "");
  const supabase = await createClient();
  const { data: domain } = await supabase.from("custom_domains").select("id,hostname,verification_token").eq("id", domainId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!domain) return;
  let verified = false;
  try {
    const answers = await resolveTxt(`_snapduka.${domain.hostname}`);
    verified = answers.some((parts) => parts.join("") === `snapduka-verification=${domain.verification_token}`);
  } catch {
    verified = false;
  }
  await supabase.from("custom_domains").update({
    status: verified ? "verified" : "failed",
    verified_at: verified ? new Date().toISOString() : null,
    last_checked_at: new Date().toISOString(),
  }).eq("id", domain.id).eq("seller_account_id", actor.sellerAccountId);
  revalidatePath("/dashboard/settings/branding");
}
