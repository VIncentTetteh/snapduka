"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveTxt } from "node:dns/promises";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { normalizeHostname } from "@/lib/domains/verification";
import { normalizePhone } from "@/lib/i18n";
import { parseBranding } from "@/lib/shops/branding";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/settings/branding";

/**
 * Branding refusals were all silent, and one sits on the happy path: theming is
 * a paid capability, so a seller on Free who picked a colour and pressed Save
 * saw the page reload with the old colour and no explanation. There is nothing
 * to distinguish that from a broken form.
 */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function saveBranding(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to change your branding.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }
  // Theme customization is a paid capability; the shop logo stays free.
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "branding")) {
    fail("Custom colours and fonts are not included in your plan.");
  }

  const parsed = parseBranding({
    accent: formData.get("accent"),
    surface: formData.get("surface"),
    font: formData.get("font"),
  });
  if (!parsed.success) fail("Check the colours and font and try again.");

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before changing its branding.");

  const { error } = await supabase.from("shop_branding").upsert({
    shop_id: shop.id,
    seller_account_id: actor.sellerAccountId,
    accent_color: parsed.data.accent,
    surface_color: parsed.data.surface,
    font_family: parsed.data.font,
  });
  if (error) fail("That branding could not be saved.");

  revalidatePath(PATH);
  // Was revalidating `/${shop.id}` — the storefront route is the slug, so the
  // buyer-facing page was never actually refreshed.
  revalidatePath(`/${shop.slug}`, "layout");
  redirect(`${PATH}?saved=branding`);
}

/**
 * Publishes (or clears) the WhatsApp number the storefront offers buyers.
 *
 * Deliberately not behind planAllows("branding"): theming is a paid extra, but
 * being reachable is not, and a free seller answering a buyer's question before
 * they abandon the cart is exactly what should happen. Owner-only, and separate
 * from seller_accounts.contact_phone — that is the seller's admin contact and
 * is never published on their behalf.
 */
export async function saveStorefrontContact(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to change your contact number.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before publishing a contact number.");

  const raw = String(formData.get("whatsapp") ?? "").trim();
  // Empty means "stop showing it", which has to stay possible.
  const number = raw ? normalizePhone(raw, actor.country) : null;
  if (number && !/^\+[1-9][0-9]{7,14}$/.test(number)) {
    fail("That does not look like a valid WhatsApp number.");
  }

  const { error } = await supabase
    .from("shop_branding")
    .upsert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, whatsapp_number: number });
  if (error) fail("That number could not be saved.");

  revalidatePath(PATH);
  revalidatePath(`/${shop.slug}`, "layout");
  redirect(`${PATH}?saved=${number ? "contact" : "contact-removed"}`);
}

export async function uploadShopLogoAction(
  dataUrl: string,
  dimensions: { height: number; width: number },
): Promise<{ success: boolean; message: string }> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) {
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
  if (actor.kind !== "seller") fail("Sign in as a seller to change your logo.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop first.");

  const { data: branding } = await supabase
    .from("shop_branding")
    .select("logo_path")
    .eq("shop_id", shop.id)
    .maybeSingle();
  if (!branding?.logo_path) fail("There is no logo to remove.");

  const { error } = await supabase
    .from("shop_branding")
    .update({ logo_path: null })
    .eq("shop_id", shop.id);
  if (error) fail("That logo could not be removed.");

  // The reference is gone, which is what the storefront reads. A leftover
  // object is a tidy-up, not something to report as a failed removal.
  const { error: storageError } = await supabase.storage
    .from("shop-logos")
    .remove([branding.logo_path]);
  if (storageError) {
    console.error("[removeShopLogoAction] reference cleared but object remains", {
      objectPath: branding.logo_path,
      error: storageError,
    });
  }

  revalidatePath(PATH);
  revalidatePath(`/${shop.slug}`, "layout");
  redirect(`${PATH}?saved=logo-removed`);
}

export async function addCustomDomain(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to add a domain.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }
  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "customDomain")) {
    fail("A custom domain is not included in your plan.");
  }

  const hostname = normalizeHostname(String(formData.get("hostname") ?? ""));
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) {
    fail("Enter a domain like shop.example.com, without http:// or a trailing path.");
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) fail("Create your shop before adding a domain.");

  // The insert error was discarded entirely, so adding a domain somebody else
  // had already claimed looked like it had worked.
  const { error } = await supabase
    .from("custom_domains")
    .insert({ shop_id: shop.id, seller_account_id: actor.sellerAccountId, hostname });
  if (error) {
    fail("That domain could not be added. It may already be in use.");
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=domain`);
}

export async function verifyCustomDomain(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to verify a domain.");
  if (!hasPermission(actor.role ?? "owner", "settings.manage")) {
    fail("Your role does not allow changing shop settings.");
  }
  const domainId = String(formData.get("domainId") ?? "");
  const supabase = await createClient();
  const { data: domain } = await supabase
    .from("custom_domains")
    .select("id,hostname,verification_token")
    .eq("id", domainId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!domain) fail("That domain could not be found.");
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

  revalidatePath(PATH);

  // A failed DNS lookup only set the row to "failed". Naming the exact record
  // to add is the difference between a seller fixing it and giving up.
  if (!verified) {
    fail(
      `No matching TXT record at _snapduka.${domain.hostname} yet. Add a TXT record with the value snapduka-verification=${domain.verification_token}, then try again — DNS can take a few minutes.`,
    );
  }

  redirect(`${PATH}?saved=domain-verified`);
}
