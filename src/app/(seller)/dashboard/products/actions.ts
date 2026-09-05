"use server";
import { oneOf, PRODUCT_STATUSES } from "@/lib/db/enums";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

/**
 * Refusals on this page were all bare returns, so a team member without
 * products.manage who tapped "delete photo" got a page reload and nothing else
 * — no deletion, no message, no reason. Every one of them now says which it
 * was, on the page the seller was working on.
 */
function failProduct(productId: string, message: string): never {
  const path = productId ? `/dashboard/products/${productId}` : "/dashboard/products";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const NOT_ALLOWED = "Your role does not allow changing products.";
const NOT_ACTIVE = "Your account is not active, so products cannot be changed.";
const INVALID_VARIANT =
  "Give the option a name, a whole-number price, and a stock count if you track stock.";

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
      "costPrice",
      "compareAtPrice",
      "videoUrl",
      "imageDataUrl",
      "imageWidth",
      "imageHeight",
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

  let videoFields: {
    video_url: string | null;
    video_provider: string | null;
    video_id: string | null;
    video_thumbnail_url: string | null;
  } = {
    video_url: null,
    video_provider: null,
    video_id: null,
    video_thumbnail_url: null,
  };
  if (parsed.data.videoUrl) {
    const parsedVideo = parseVideoUrl(parsed.data.videoUrl);
    const thumbnailUrl =
      parsedVideo.thumbnailUrl ??
      (parsedVideo.videoId ? await fetchOembedThumbnail(parsedVideo.provider, parsed.data.videoUrl) : null);
    videoFields = {
      video_url: parsed.data.videoUrl,
      video_provider: parsedVideo.provider,
      video_id: parsedVideo.videoId,
      video_thumbnail_url: thumbnailUrl,
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
      cost_minor: parsed.data.costMinor,
      compare_at_price_minor: parsed.data.compareAtPriceMinor,
      sku: parsed.data.sku || null,
      status: parsed.data.status,
      inventory_policy: parsed.data.inventoryPolicy,
      stock_quantity: parsed.data.stockQuantity,
      published_at: parsed.data.status === "active" ? new Date().toISOString() : null,
      ...videoFields,
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

  let photoMessage = "";
  const imageDataUrl = values.imageDataUrl;
  if (imageDataUrl) {
    const width = Number(values.imageWidth) || 0;
    const height = Number(values.imageHeight) || 0;
    const uploadResult = await uploadProductImageAction(product.id, imageDataUrl, { width, height });
    photoMessage = uploadResult.success ? "" : " Photo upload failed — add it below.";
  }

  revalidatePath("/dashboard/products");
  revalidatePath("/onboarding");
  return {
    status: "success",
    message:
      (parsed.data.status === "active" ? "Product published." : "Product saved as a draft.") +
      (photoMessage || (imageDataUrl ? "" : " Add an image below.")),
    values: {},
    productId: product.id,
  };
}

export async function setProductStatusAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  const status = oneOf(value(formData, "status"), PRODUCT_STATUSES);

  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) {
    failProduct(productId, NOT_ALLOWED);
  }
  if (!["pending", "active"].includes(actor.status)) failProduct(productId, NOT_ACTIVE);
  if (!status) failProduct(productId, "That product status is not valid.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      status,
      published_at: status === "active" ? new Date().toISOString() : null,
    })
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (error) failProduct(productId, "That product could not be updated.");

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
  const productId = value(formData, "productId");
  const mediaId = value(formData, "mediaId");
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) {
    failProduct(productId, NOT_ALLOWED);
  }
  if (!productId || !mediaId) failProduct(productId, "That photo could not be identified.");

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("product_media")
    .select("id,position")
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId)
    .order("position");
  if (!media?.some((item) => item.id === mediaId)) {
    failProduct(productId, "That photo is no longer on this product.");
  }

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
  const productId = value(formData, "productId");
  const mediaId = value(formData, "mediaId");
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) {
    failProduct(productId, NOT_ALLOWED);
  }
  if (!productId || !mediaId) failProduct(productId, "That photo could not be identified.");

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("product_media")
    .select("id,object_path")
    .eq("id", mediaId)
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!media) failProduct(productId, "That photo is no longer on this product.");

  const { error: deleteError } = await supabase
    .from("product_media")
    .delete()
    .eq("id", media.id);
  if (deleteError) failProduct(productId, "That photo could not be deleted.");

  // The row is gone either way; a leftover object is a storage tidy-up, not a
  // reason to tell the seller the deletion failed.
  const { error: storageError } = await supabase.storage
    .from("product-images")
    .remove([media.object_path]);
  if (storageError) {
    console.error("[deleteProductImageAction] row deleted but object remains", {
      objectPath: media.object_path,
      error: storageError,
    });
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${productId}`);
}

export async function bulkProductStatusAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const ids = formData.getAll("productIds").map(String).slice(0, 100);
  const status = oneOf(value(formData, "status"), PRODUCT_STATUSES);
  if (actor.kind !== "seller") failProduct("", "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct("", NOT_ALLOWED);
  if (!ids.length) failProduct("", "Select at least one product first.");
  if (!status) failProduct("", "That product status is not valid.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ status, published_at: status === "active" ? new Date().toISOString() : null })
    .eq("seller_account_id", actor.sellerAccountId)
    .in("id", ids);
  if (error) failProduct("", "Those products could not be updated.");

  revalidatePath("/dashboard/products");
}

export async function updateProductAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct(productId, NOT_ALLOWED);
  if (!productId) failProduct("", "That product could not be identified.");
  const parsed = parseProductInput({
    currency: value(formData, "currency"),
    description: value(formData, "description"),
    inventoryPolicy: value(formData, "inventoryPolicy"),
    name: value(formData, "name"),
    price: value(formData, "price"),
    costPrice: value(formData, "costPrice"),
    compareAtPrice: value(formData, "compareAtPrice"),
    sku: value(formData, "sku"),
    status: value(formData, "status"),
    stockQuantity: value(formData, "stockQuantity"),
  });
  // parseProductInput already produces field-level messages; this form has no
  // place to show them, so the first one is surfaced rather than dropped.
  if (!parsed.success) {
    const first = Object.values(parsed.fieldErrors ?? {})[0]?.[0];
    failProduct(productId, first ?? "Check the product details and try again.");
  }

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, currency")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  if (!shop) failProduct(productId, "Create your shop before editing products.");
  if (shop.currency !== parsed.data.currency) {
    failProduct(productId, `Products in this shop are priced in ${shop.currency}.`);
  }

  const { error } = await supabase.from("products").update({
    currency: parsed.data.currency,
    description: parsed.data.description,
    inventory_policy: parsed.data.inventoryPolicy,
    name: parsed.data.name,
    price_minor: parsed.data.priceMinor,
    cost_minor: parsed.data.costMinor,
    compare_at_price_minor: parsed.data.compareAtPriceMinor,
    published_at: parsed.data.status === "active" ? new Date().toISOString() : null,
    sku: parsed.data.sku || null,
    status: parsed.data.status,
    stock_quantity: parsed.data.stockQuantity,
  }).eq("id", productId).eq("seller_account_id", actor.sellerAccountId);
  if (error) failProduct(productId, "Those changes could not be saved.");

  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
  redirect(`/dashboard/products/${productId}?saved=1`);
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
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct(productId, NOT_ALLOWED);
  if (!productId) failProduct("", "That product could not be identified.");
  // variantInput returns null for a missing name, a non-numeric price, or a
  // tracked variant with no stock figure — all things the seller can see and
  // fix, and none of which used to be mentioned.
  if (!input) failProduct(productId, INVALID_VARIANT);

  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id").eq("id", productId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!product) failProduct(productId, "That product could not be found.");

  const { error } = await supabase
    .from("product_variants")
    .insert({ ...input, product_id: productId, seller_account_id: actor.sellerAccountId });
  if (error) failProduct(productId, "That option could not be added.");

  revalidatePath(`/dashboard/products/${productId}`);
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  const variantId = value(formData, "variantId");
  const input = variantInput(formData);
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct(productId, NOT_ALLOWED);
  if (!productId || !variantId) failProduct(productId, "That option could not be identified.");
  if (!input) failProduct(productId, INVALID_VARIANT);

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update(input)
    .eq("id", variantId)
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (error) failProduct(productId, "That option could not be saved.");

  revalidatePath(`/dashboard/products/${productId}`);
}

export async function archiveVariantAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct(productId, NOT_ALLOWED);

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ active: false })
    .eq("id", value(formData, "variantId"))
    .eq("product_id", productId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (error) failProduct(productId, "That option could not be removed.");

  revalidatePath(`/dashboard/products/${productId}`);
}

export async function setProductVideoAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  const productId = value(formData, "productId");
  if (actor.kind !== "seller") failProduct(productId, "Sign in as a seller to change products.");
  if (!hasPermission(actor.role ?? "owner", "products.manage")) failProduct(productId, NOT_ALLOWED);
  if (!["pending", "active"].includes(actor.status)) failProduct(productId, NOT_ACTIVE);
  if (!productId) failProduct("", "That product could not be identified.");

  const videoUrl = value(formData, "videoUrl").trim();
  const supabase = await createClient();

  // An empty field means "remove the video", which is a real outcome rather
  // than a refusal.
  if (!videoUrl) {
    const { error: clearError } = await supabase
      .from("products")
      .update({ video_url: null, video_provider: null, video_id: null, video_thumbnail_url: null })
      .eq("id", productId)
      .eq("seller_account_id", actor.sellerAccountId);
    if (clearError) failProduct(productId, "That video could not be removed.");
    revalidatePath(`/dashboard/products/${productId}`);
    revalidatePath("/dashboard/products");
    return;
  }

  if (!isSafeHttpUrl(videoUrl)) {
    failProduct(
      productId,
      "That video link cannot be used. Paste a public https link from YouTube, TikTok, Instagram or Vimeo.",
    );
  }

  const parsed = parseVideoUrl(videoUrl);
  const thumbnailUrl =
    parsed.thumbnailUrl ??
    (parsed.videoId ? await fetchOembedThumbnail(parsed.provider, videoUrl) : null);

  const { error: videoError } = await supabase
    .from("products")
    .update({
      video_url: videoUrl,
      video_provider: parsed.provider,
      video_id: parsed.videoId,
      video_thumbnail_url: thumbnailUrl,
    })
    .eq("id", productId)
    .eq("seller_account_id", actor.sellerAccountId);
  if (videoError) failProduct(productId, "That video could not be saved.");

  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
}
