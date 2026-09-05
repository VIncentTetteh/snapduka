"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write";

const MODERATION_DECISIONS = ["hidden", "flagged", "clear"] as const;
type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

/**
 * Moderation and catalogue taxonomy, and why silence is expensive here: hiding
 * a product takes it off every storefront it appears on. An operator who
 * believes they hid something that is still selling has no way to find out from
 * this screen — the page just re-rendered.
 */
function failProducts(productId: string, message: string): never {
  const path = productId ? `/admin/products/${productId}` : "/admin/products";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `category-${randomUUID().slice(0, 8)}`;
}

export async function setProductModerationAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/products");
  const productId = String(formData.get("productId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!productId) failProducts("", "That product could not be identified.");
  if (!MODERATION_DECISIONS.includes(decision as ModerationDecision)) {
    failProducts(productId, "Choose whether to hide, flag or clear this product.");
  }
  if (!reason) failProducts(productId, "Record why before moderating a product.");

  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products")
    .select("id,moderation_status")
    .eq("id", productId)
    .maybeSingle();
  if (!product) failProducts(productId, "That product could not be found.");

  const now = new Date().toISOString();
  const { error } = await admin
    .from("products")
    .update({
      moderation_status: decision,
      moderation_reason: reason,
      moderated_by: actor.userId,
      moderated_at: now,
    })
    .eq("id", productId);
  // Reporting success on a product that is still visible is the failure to
  // avoid: the operator has no other signal that it did not take.
  if (error) failProducts(productId, "That moderation decision could not be applied.");

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `product_${decision}`,
    entityType: "product",
    entityId: productId,
    before: { moderationStatus: product.moderation_status },
    after: { moderationStatus: decision, reason },
    metadata: {},
  });

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  redirect(`/admin/products/${productId}?saved=${encodeURIComponent(`Product ${decision}.`)}`);
}

export async function bulkModerateProductsAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/products");
  const productIds = formData.getAll("productIds").map(String).slice(0, 100);
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!productIds.length) failProducts("", "Select at least one product first.");
  if (!MODERATION_DECISIONS.includes(decision as ModerationDecision)) {
    failProducts("", "Choose whether to hide, flag or clear these products.");
  }
  if (!reason) failProducts("", "Record why before moderating products.");

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("products")
    .update({
      moderation_status: decision,
      moderation_reason: reason,
      moderated_by: actor.userId,
      moderated_at: now,
    })
    .in("id", productIds);
  if (error) failProducts("", "Those products could not be moderated.");

  await Promise.all(
    productIds.map((productId) =>
      writeAuditEvent(admin, {
        actorType: "admin",
        actorId: actor.userId,
        action: `product_${decision}`,
        entityType: "product",
        entityId: productId,
        before: null,
        after: { moderationStatus: decision, reason },
        metadata: { bulk: true, count: productIds.length },
      }),
    ),
  );

  revalidatePath("/admin/products");
  redirect(
    `/admin/products?saved=${encodeURIComponent(
      `${productIds.length} product${productIds.length === 1 ? "" : "s"} ${decision}.`,
    )}`,
  );
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/products");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) failProducts("", "Give the category a name.");

  const admin = createAdminClient();
  const { data: category, error } = await admin
    .from("categories")
    .insert({ name, slug: slugify(name), description })
    .select("id")
    .maybeSingle();
  // A duplicate slug is the likely cause and the operator can act on it.
  if (error || !category) {
    failProducts("", "That category could not be created. One with this name may already exist.");
  }

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "category_created",
    entityType: "category",
    entityId: category.id,
    before: null,
    after: { name, description },
    metadata: {},
  });

  revalidatePath("/admin/products");
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/products");
  const categoryId = String(formData.get("categoryId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!categoryId) failProducts("", "That category could not be identified.");

  const admin = createAdminClient();
  const { error } = await admin.from("categories").update({ active }).eq("id", categoryId);
  if (error) failProducts("", "That category could not be updated.");

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: active ? "category_restored" : "category_archived",
    entityType: "category",
    entityId: categoryId,
    before: null,
    after: { active },
    metadata: {},
  });

  revalidatePath("/admin/products");
}

export async function setProductCategoriesAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/products");
  const productId = String(formData.get("productId") ?? "");
  const categoryIds = formData.getAll("categoryIds").map(String);
  if (!productId) failProducts("", "That product could not be identified.");

  const admin = createAdminClient();
  // The delete lands first, so a failed insert leaves the product with no
  // categories at all — worth saying rather than leaving the operator to
  // discover it on the next page load.
  const { error: clearError } = await admin
    .from("product_categories")
    .delete()
    .eq("product_id", productId);
  if (clearError) failProducts(productId, "Those categories could not be saved.");

  if (categoryIds.length) {
    const { error: insertError } = await admin.from("product_categories").insert(
      categoryIds.map((categoryId) => ({
        product_id: productId,
        category_id: categoryId,
        assigned_by: actor.userId,
      })),
    );
    if (insertError) {
      failProducts(
        productId,
        "Those categories could not be saved, and the product now has none. Set them again.",
      );
    }
  }

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "product_categories_updated",
    entityType: "product",
    entityId: productId,
    before: null,
    after: { categoryIds },
    metadata: {},
  });

  revalidatePath(`/admin/products/${productId}`);
}
