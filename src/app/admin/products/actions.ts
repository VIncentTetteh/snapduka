"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

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

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: `product_${decision}`,
    p_entity_type: "product",
    p_entity_id: productId,
    p_before_data: { moderationStatus: product.moderation_status },
    p_after_data: { moderationStatus: decision, reason },
    p_metadata: {},
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
      admin.rpc("write_audit_event", {
        p_actor_type: "admin",
        p_actor_id: actor.userId,
        p_action: `product_${decision}`,
        p_entity_type: "product",
        p_entity_id: productId,
        p_before_data: null,
        p_after_data: { moderationStatus: decision, reason },
        p_metadata: { bulk: true, count: productIds.length },
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

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: "category_created",
    p_entity_type: "category",
    p_entity_id: category.id,
    p_before_data: null,
    p_after_data: { name, description },
    p_metadata: {},
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

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: active ? "category_restored" : "category_archived",
    p_entity_type: "category",
    p_entity_id: categoryId,
    p_before_data: null,
    p_after_data: { active },
    p_metadata: {},
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

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: "product_categories_updated",
    p_entity_type: "product",
    p_entity_id: productId,
    p_before_data: null,
    p_after_data: { categoryIds },
    p_metadata: {},
  });

  revalidatePath(`/admin/products/${productId}`);
}
