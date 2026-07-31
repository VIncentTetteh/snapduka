"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write";

const MODERATION_DECISIONS = ["hidden", "flagged", "clear"] as const;
type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

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
  if (actor.kind !== "operator") return;
  const productId = String(formData.get("productId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!productId || !reason || !MODERATION_DECISIONS.includes(decision as ModerationDecision)) return;

  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products")
    .select("id,moderation_status")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return;

  const now = new Date().toISOString();
  await admin
    .from("products")
    .update({
      moderation_status: decision,
      moderation_reason: reason,
      moderated_by: actor.userId,
      moderated_at: now,
    })
    .eq("id", productId);

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
}

export async function bulkModerateProductsAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const productIds = formData.getAll("productIds").map(String).slice(0, 100);
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!productIds.length || !reason || !MODERATION_DECISIONS.includes(decision as ModerationDecision)) return;

  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("products")
    .update({
      moderation_status: decision,
      moderation_reason: reason,
      moderated_by: actor.userId,
      moderated_at: now,
    })
    .in("id", productIds);

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
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return;

  const admin = createAdminClient();
  const { data: category, error } = await admin
    .from("categories")
    .insert({ name, slug: slugify(name), description })
    .select("id")
    .maybeSingle();
  if (error || !category) return;

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
  if (actor.kind !== "operator") return;
  const categoryId = String(formData.get("categoryId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!categoryId) return;

  const admin = createAdminClient();
  await admin.from("categories").update({ active }).eq("id", categoryId);

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
  if (actor.kind !== "operator") return;
  const productId = String(formData.get("productId") ?? "");
  const categoryIds = formData.getAll("categoryIds").map(String);
  if (!productId) return;

  const admin = createAdminClient();
  await admin.from("product_categories").delete().eq("product_id", productId);
  if (categoryIds.length) {
    await admin.from("product_categories").insert(
      categoryIds.map((categoryId) => ({
        product_id: productId,
        category_id: categoryId,
        assigned_by: actor.userId,
      })),
    );
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
