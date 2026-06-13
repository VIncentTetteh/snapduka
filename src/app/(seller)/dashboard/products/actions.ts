"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { parseProductInput } from "@/lib/catalog/schema";
import { createClient } from "@/lib/supabase/server";

export type ProductActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values: Record<string, string>;
};

function value(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "product"}-${randomUUID().slice(0, 8)}`;
}

export async function createProductAction(
  _previous: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const values = Object.fromEntries(
    [
      "name",
      "description",
      "price",
      "currency",
      "inventoryPolicy",
      "stockQuantity",
      "sku",
      "status",
      "variantName",
      "variantPrice",
      "variantSku",
      "variantStock",
    ].map((name) => [name, value(formData, name)]),
  );
  const actor = await resolveServerActor();

  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","products.manage") || !["pending", "active"].includes(actor.status)) {
    return {
      status: "error",
      message: "Sign in with an active seller account.",
      values,
    };
  }

  const parsed = parseProductInput(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted product details.",
      fieldErrors: parsed.fieldErrors,
      values,
    };
  }

  const supabase = await createClient();
  const { data: shop, error: shopError } = await supabase
    .from("shops")
    .select("id, currency")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();

  if (shopError || !shop) {
    return {
      status: "error",
      message: "Finish your shop setup before adding products.",
      values,
    };
  }

  if (shop.currency !== parsed.data.currency) {
    return {
      status: "error",
      message: "The product currency must match your shop currency.",
      fieldErrors: { currency: ["Use your shop currency."] },
      values,
    };
  }

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      shop_id: shop.id,
      seller_account_id: actor.sellerAccountId,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description,
      currency: parsed.data.currency,
      price_minor: parsed.data.priceMinor,
      sku: parsed.data.sku || null,
      status: parsed.data.status,
      inventory_policy: parsed.data.inventoryPolicy,
      stock_quantity: parsed.data.stockQuantity,
      published_at: parsed.data.status === "active" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !product) {
    return {
      status: "error",
      message: "The product could not be saved. Check the SKU and try again.",
      values,
    };
  }

  if (values.variantName.trim()) {
    const variantPrice = values.variantPrice
      ? Number(values.variantPrice)
      : parsed.data.priceMinor;
    const variantStock =
      parsed.data.inventoryPolicy === "track"
        ? Number(values.variantStock || parsed.data.stockQuantity || 0)
        : null;
    const { error: variantError } = await supabase.from("product_variants").insert({
      product_id: product.id,
      seller_account_id: actor.sellerAccountId,
      name: values.variantName.trim(),
      sku: values.variantSku.trim() || null,
      price_minor: variantPrice,
      inventory_policy: parsed.data.inventoryPolicy,
      stock_quantity: variantStock,
    });

    if (variantError) {
      await supabase.from("products").delete().eq("id", product.id);
      return {
        status: "error",
        message: "The variant could not be saved. Check its price, SKU, and stock.",
        values,
      };
    }
  }

  revalidatePath("/dashboard/products");
  revalidatePath("/onboarding");
  return {
    status: "success",
    message:
      parsed.data.status === "active"
        ? "Product published."
        : "Product saved as a draft.",
    values: {},
  };
}

export async function setProductStatusAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  const status = value(formData, "status");

  if (
    actor.kind !== "seller" ||
    !hasPermission(actor.role ?? "owner","products.manage") ||
    !["pending", "active"].includes(actor.status) ||
    !["draft", "active", "archived"].includes(status)
  ) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("products")
    .update({
      status,
      published_at: status === "active" ? new Date().toISOString() : null,
    })
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId);

  revalidatePath("/dashboard/products");
  revalidatePath("/onboarding");
}

export async function bulkProductStatusAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const ids = formData.getAll("productIds").map(String).slice(0, 100);
  const status = value(formData, "status");
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","products.manage") || !ids.length || !["draft", "active", "archived"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("products").update({ status, published_at: status === "active" ? new Date().toISOString() : null }).eq("seller_account_id", actor.sellerAccountId).in("id", ids);
  revalidatePath("/dashboard/products");
}
