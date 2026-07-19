"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planLimit, withinPlanLimit } from "@/lib/billing/resolve";
import { parseProductInput } from "@/lib/catalog/schema";
import { fetchOembedThumbnail, isSafeHttpUrl, parseVideoUrl } from "@/lib/catalog/video";
import { createClient } from "@/lib/supabase/server";

export type ProductActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values: Record<string, string>;
  productId?: string;
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

  // Catalogue size is a plan entitlement; archived products don't count.
  const [plan, { count: productCount }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .neq("status", "archived"),
  ]);
  if (!withinPlanLimit(plan, "products", productCount ?? 0)) {
    return {
      status: "error",
      message: `Your ${plan.planName} plan includes up to ${planLimit(plan, "products")} products. Upgrade in Settings → Plan & billing to add more.`,
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
        ? "Product published. Add an image below."
        : "Product saved as a draft. Add an image below.",
    values: {},
    productId: product.id,
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

export async function uploadProductImageAction(
  productId: string,
  dataUrl: string,
  dimensions: { height: number; width: number },
): Promise<{ success: boolean; message: string }> {
  const actor = await resolveServerActor();

  if (actor.kind !== "seller" || !["pending", "active"].includes(actor.status)) {
    return { success: false, message: "Sign in with an active seller account." };
  }

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId)
    .single();

  if (!product) {
    return { success: false, message: "Product not found." };
  }

  const base64 = dataUrl.split(",")[1];
  if (!base64 || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 1000 || dimensions.height > 1000) {
    return { success: false, message: "Invalid image data." };
  }

  const buffer = Buffer.from(base64, "base64");
  const objectPath = `${actor.sellerAccountId}/${productId}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(objectPath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    return { success: false, message: "Image upload failed. Please try again." };
  }

  const { data: existing } = await supabase
    .from("product_media")
    .select("position")
    .eq("product_id", productId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: mediaError } = await supabase.from("product_media").insert({
    alt_text: "",
    height: dimensions.height,
    object_path: objectPath,
    position: existing ? existing.position + 1 : 0,
    product_id: productId,
    seller_account_id: actor.sellerAccountId,
    width: dimensions.width,
  });

  if (mediaError) {
    await supabase.storage.from("product-images").remove([objectPath]);
    return { success: false, message: "Image could not be saved. Please try again." };
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${productId}`);
  return { success: true, message: "Image saved." };
}

/** Moves the chosen image to position 0 — the main image customers see first. */
export async function setMainImageAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage")) return;
  const productId = value(formData, "productId");
  const mediaId = value(formData, "mediaId");
  if (!productId || !mediaId) return;

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("product_media")
    .select("id,position")
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId)
    .order("position");
  if (!media?.some((item) => item.id === mediaId)) return;

  const reordered = [
    mediaId,
    ...media.map((item) => item.id).filter((id) => id !== mediaId),
  ];
  // Two passes keep positions unique at every step (object_path stays fixed,
  // but positions must never collide mid-update for deterministic ordering).
  for (const [index, id] of reordered.entries()) {
    await supabase
      .from("product_media")
      .update({ position: index + media.length })
      .eq("id", id)
      .eq("seller_account_id", actor.sellerAccountId);
  }
  for (const [index, id] of reordered.entries()) {
    await supabase
      .from("product_media")
      .update({ position: index })
      .eq("id", id)
      .eq("seller_account_id", actor.sellerAccountId);
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${productId}`);
}

export async function deleteProductImageAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage")) return;
  const productId = value(formData, "productId");
  const mediaId = value(formData, "mediaId");
  if (!productId || !mediaId) return;

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("product_media")
    .select("id,object_path")
    .eq("id", mediaId)
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!media) return;

  await supabase.from("product_media").delete().eq("id", media.id);
  await supabase.storage.from("product-images").remove([media.object_path]);

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${productId}`);
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

export async function updateProductAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage") || !productId) return;
  const parsed = parseProductInput({
    currency: value(formData, "currency"),
    description: value(formData, "description"),
    inventoryPolicy: value(formData, "inventoryPolicy"),
    name: value(formData, "name"),
    price: value(formData, "price"),
    sku: value(formData, "sku"),
    status: value(formData, "status"),
    stockQuantity: value(formData, "stockQuantity"),
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, currency")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop || shop.currency !== parsed.data.currency) return;
  await supabase.from("products").update({
    currency: parsed.data.currency,
    description: parsed.data.description,
    inventory_policy: parsed.data.inventoryPolicy,
    name: parsed.data.name,
    price_minor: parsed.data.priceMinor,
    published_at: parsed.data.status === "active" ? new Date().toISOString() : null,
    sku: parsed.data.sku || null,
    status: parsed.data.status,
    stock_quantity: parsed.data.stockQuantity,
  }).eq("id", productId).eq("seller_account_id", actor.sellerAccountId);
  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
}

function variantInput(formData: FormData) {
  const inventoryPolicy = value(formData, "inventoryPolicy");
  const name = value(formData, "name").trim();
  const price = value(formData, "price");
  const stock = value(formData, "stock");
  if (!name || !["track", "continue_selling", "deny_when_out_of_stock"].includes(inventoryPolicy)) return null;
  if (price && !/^\d+$/.test(price)) return null;
  if (inventoryPolicy === "track" && !/^\d+$/.test(stock)) return null;
  return { active: value(formData, "active") !== "false", inventory_policy: inventoryPolicy as "track" | "continue_selling" | "deny_when_out_of_stock", name, price_minor: price ? Number(price) : null, sku: value(formData, "sku").trim() || null, stock_quantity: inventoryPolicy === "track" ? Number(stock) : null };
}

export async function addVariantAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  const input = variantInput(formData);
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage") || !productId || !input) return;
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id").eq("id", productId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!product) return;
  await supabase.from("product_variants").insert({ ...input, product_id: productId, seller_account_id: actor.sellerAccountId });
  revalidatePath(`/dashboard/products/${productId}`);
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  const variantId = value(formData, "variantId");
  const input = variantInput(formData);
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage") || !productId || !variantId || !input) return;
  const supabase = await createClient();
  await supabase.from("product_variants").update(input).eq("id", variantId).eq("product_id", productId).eq("seller_account_id", actor.sellerAccountId);
  revalidatePath(`/dashboard/products/${productId}`);
}

export async function archiveVariantAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage")) return;
  const supabase = await createClient();
  await supabase.from("product_variants").update({ active: false }).eq("id", value(formData, "variantId")).eq("product_id", productId).eq("seller_account_id", actor.sellerAccountId);
  revalidatePath(`/dashboard/products/${productId}`);
}

export async function setProductVideoAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "products.manage") || !["pending", "active"].includes(actor.status) || !productId) return;

  const videoUrl = value(formData, "videoUrl").trim();
  const supabase = await createClient();

  if (!videoUrl) {
    await supabase
      .from("products")
      .update({ video_url: null, video_provider: null, video_id: null, video_thumbnail_url: null })
      .eq("id", productId)
      .eq("seller_account_id", actor.sellerAccountId);
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath("/dashboard/products");
    return;
  }

  if (!isSafeHttpUrl(videoUrl)) return;

  const parsed = parseVideoUrl(videoUrl);
  const thumbnailUrl =
    parsed.thumbnailUrl ??
    (parsed.videoId ? await fetchOembedThumbnail(parsed.provider, videoUrl) : null);

  await supabase
    .from("products")
    .update({
      video_url: videoUrl,
      video_provider: parsed.provider,
      video_id: parsed.videoId,
      video_thumbnail_url: thumbnailUrl,
    })
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId);

  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
}
