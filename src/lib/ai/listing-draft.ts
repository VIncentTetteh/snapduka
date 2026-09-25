import "server-only";

import { z } from "zod";

import { formatMoney, type CountryCode, type CurrencyCode } from "@snapduka/core";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

import { AI_MODELS, cachedSystem, modelCaller } from "./client";
import { generateStructured } from "./structured";

/**
 * Snap-to-list: one product photo in, a draft listing out.
 *
 * Three rules shape everything here:
 *  - **The draft never publishes.** It is returned to the seller to review and
 *    edit; nothing is written to `products`. The seller's own save is the only
 *    path to a listing, so a hallucinated "100% original leather" can only go
 *    live if a person read it and kept it.
 *  - **The price never comes from the model.** A vision model guessing what
 *    shea butter sells for in Kumasi is a hallucination with a currency sign on
 *    it. `suggest_price` answers from what active listings in the same category
 *    and country are priced at, and says so.
 *  - **The category comes from the real taxonomy.** The model is shown the
 *    `categories` table and must pick an id from it; anything else is dropped.
 */

export const LISTING_DRAFT_BUCKET = "product-images";
/** Anthropic accepts up to 5 MB per image *encoded*; base64 inflates by 4/3. */
export const MAX_IMAGE_BYTES = 3_750_000;
const ACCEPTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number];
/** Bounded explicitly: PostgREST's db.max_rows would cap it silently at 1000. */
const MAX_CATEGORIES = 400;

export type ListingDraftImage =
  | { kind: "storage"; path: string }
  | { kind: "base64"; data: string; mediaType: string };

const modelDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  descriptionLocal: z
    .object({ language: z.enum(["tw", "pcm"]), text: z.string().trim().min(1).max(2000) })
    .nullable()
    .optional(),
  categoryId: z.string().nullable().optional(),
  attributes: z.record(z.string().max(40), z.string().max(120)).default({}),
  variantSuggestions: z
    .array(z.object({ name: z.string().trim().min(1).max(40), options: z.array(z.string().trim().min(1).max(40)).max(12) }))
    .max(4)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export type ListingDraft = {
  title: string;
  description: string;
  descriptionLocal: { language: "tw" | "pcm"; text: string } | null;
  category: { id: string; name: string } | null;
  attributes: Record<string, string>;
  variantSuggestions: { name: string; options: string[] }[];
  tags: string[];
  price: PriceSuggestion;
  /** Always "draft": the seller publishes, never this feature. */
  status: "draft";
};

export type PriceSuggestion = {
  currency: CurrencyCode;
  sampleSize: number;
  p25Minor: number | null;
  medianMinor: number | null;
  p75Minor: number | null;
  explanation: string;
};

export type ListingDraftResult =
  | { ok: true; draft: ListingDraft }
  | {
      ok: false;
      reason: "not_enabled" | "not_configured" | "budget_exceeded" | "invalid_image" | "no_shop" | "failed";
      message: string;
    };

const COUNTRY_NAMES: Record<CountryCode, string> = { GH: "Ghana", NG: "Nigeria", CI: "Côte d'Ivoire" };

function isAcceptedMediaType(value: string): value is ImageMediaType {
  return (ACCEPTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * A storage path is only accepted inside the caller's own folder. Product
 * images are stored as `<sellerId>/<productId>/<imageId>.jpg`, and the bucket
 * is public — so "is it in the bucket" proves nothing about whose photo it is,
 * and without this any seller could spend their AI budget describing another
 * seller's unreleased stock.
 */
export function isOwnStoragePath(sellerAccountId: string, path: string): boolean {
  return (
    path.startsWith(`${sellerAccountId}/`) &&
    !path.includes("..") &&
    !path.includes("//") &&
    /^[A-Za-z0-9/_.-]+$/.test(path)
  );
}

function mediaTypeFromPath(path: string): ImageMediaType | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

async function loadImage(
  sellerAccountId: string,
  image: ListingDraftImage,
): Promise<{ ok: true; data: string; mediaType: ImageMediaType } | { ok: false; message: string }> {
  if (image.kind === "base64") {
    const data = image.data.replace(/^data:[^;]+;base64,/, "");
    if (!isAcceptedMediaType(image.mediaType)) return { ok: false, message: "Use a JPEG, PNG or WebP photo." };
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, message: "The photo could not be read." };
    if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) {
      return { ok: false, message: "The photo is too large. Use one under 3.5 MB." };
    }
    return { ok: true, data, mediaType: image.mediaType };
  }

  if (!isOwnStoragePath(sellerAccountId, image.path)) {
    return { ok: false, message: "That photo is not in your shop's storage." };
  }
  const { data: blob, error } = await createAdminClient().storage.from(LISTING_DRAFT_BUCKET).download(image.path);
  if (error || !blob) return { ok: false, message: "That photo could not be found." };
  if (blob.size > MAX_IMAGE_BYTES) return { ok: false, message: "The photo is too large. Use one under 3.5 MB." };
  const mediaType = isAcceptedMediaType(blob.type) ? blob.type : mediaTypeFromPath(image.path);
  if (!mediaType) return { ok: false, message: "Use a JPEG, PNG or WebP photo." };
  return { ok: true, data: Buffer.from(await blob.arrayBuffer()).toString("base64"), mediaType };
}

/**
 * The system prompt is identical for every seller until the taxonomy changes,
 * so it is the cached prefix. Nothing per-seller or per-request may appear in
 * it — the shop's country goes in the user turn.
 */
export function listingSystemPrompt(categories: { id: string; name: string }[]): string {
  const taxonomy = categories.length
    ? categories.map((category) => `${category.id} | ${category.name}`).join("\n")
    : "(no categories are configured; use null)";
  return [
    "You write product listings for small online shops in West Africa (Ghana, Nigeria, Côte d'Ivoire) from a single product photo.",
    "Describe only what the photo shows. Never invent brand names, certifications, materials, sizes or quantities you cannot see; if something matters but is not visible, leave it out.",
    "Never state or suggest a price. Pricing is handled elsewhere.",
    "Write plainly for buyers on WhatsApp and Instagram: a short, specific title (under 80 characters) and a 2-4 sentence description.",
    "If the product is plainly aimed at a Ghanaian or Nigerian local market, you may add descriptionLocal in Twi (tw) or Nigerian Pidgin (pcm); otherwise set it to null.",
    "Pick categoryId only from this list (id | name). If none fits, use null:",
    taxonomy,
    "Reply with only a JSON object with these keys:",
    '{"title": string, "description": string, "descriptionLocal": {"language": "tw"|"pcm", "text": string} | null, "categoryId": string | null, "attributes": {string: string}, "variantSuggestions": [{"name": string, "options": [string]}], "tags": [string]}',
    "attributes are visible facts such as colour or material; variantSuggestions only when the photo shows options (several colours, sizes). At most 10 tags, lowercase.",
  ].join("\n");
}

export function priceExplanation(input: {
  categoryName: string | null;
  country: CountryCode;
  currency: CurrencyCode;
  sampleSize: number;
  p25Minor: number | null;
  medianMinor: number | null;
  p75Minor: number | null;
}): string {
  if (!input.categoryName) {
    return "Pick a category to see what similar products sell for. Set your own price.";
  }
  if (input.medianMinor === null || input.p25Minor === null || input.p75Minor === null) {
    return `Not enough ${input.categoryName} listings in ${COUNTRY_NAMES[input.country]} to suggest a price yet. Set your own price.`;
  }
  const money = (minor: number) => formatMoney(minor, input.currency);
  return `Based on ${input.sampleSize} active ${input.categoryName} listings in ${COUNTRY_NAMES[input.country]}: most are priced between ${money(input.p25Minor)} and ${money(input.p75Minor)}, and the middle price is ${money(input.medianMinor)}. This is a guide, not a rule; you set the price.`;
}

async function suggestPrice(
  category: { id: string; name: string } | null,
  country: CountryCode,
  currency: CurrencyCode,
): Promise<PriceSuggestion> {
  const empty = { currency, sampleSize: 0, p25Minor: null, medianMinor: null, p75Minor: null };
  if (!category) {
    return { ...empty, explanation: priceExplanation({ ...empty, categoryName: null, country }) };
  }
  const { data, error } = await createAdminClient().rpc("suggest_price", {
    p_category_id: category.id,
    p_country: country,
  });
  if (error) console.error("[ai/listing-draft] suggest_price failed", error);
  // A country trades in one currency, but match on it rather than assume: a
  // suggestion in the wrong currency would be worse than none.
  const row = (data ?? []).find((candidate) => candidate.currency === currency);
  const suggestion = row
    ? {
        currency,
        sampleSize: row.sample_size,
        p25Minor: row.p25_minor,
        medianMinor: row.median_minor,
        p75Minor: row.p75_minor,
      }
    : empty;
  return {
    ...suggestion,
    explanation: priceExplanation({ ...suggestion, categoryName: category.name, country }),
  };
}

export async function createListingDraft(input: {
  sellerAccountId: string;
  image: ListingDraftImage;
}): Promise<ListingDraftResult> {
  if (!(await isFeatureEnabled("snap_to_list", { sellerAccountId: input.sellerAccountId }))) {
    return { ok: false, reason: "not_enabled", message: "Drafting from a photo is not available on your shop yet." };
  }

  const admin = createAdminClient();
  const [{ data: shop }, { data: categories, error: categoriesError }] = await Promise.all([
    admin
      .from("shops")
      .select("country,currency")
      .eq("seller_account_id", input.sellerAccountId)
      .maybeSingle(),
    admin
      .from("categories")
      .select("id,name")
      .eq("active", true)
      .order("position")
      .order("name")
      .limit(MAX_CATEGORIES),
  ]);
  if (!shop) return { ok: false, reason: "no_shop", message: "Finish your shop setup first." };
  if (categoriesError) console.error("[ai/listing-draft] categories failed", categoriesError);
  const taxonomy = categories ?? [];

  const image = await loadImage(input.sellerAccountId, input.image);
  if (!image.ok) return { ok: false, reason: "invalid_image", message: image.message };

  const country = shop.country as CountryCode;
  const currency = shop.currency as CurrencyCode;
  const result = await generateStructured({
    call: modelCaller({
      sellerAccountId: input.sellerAccountId,
      purpose: "listing_draft",
      model: AI_MODELS.vision,
      context: { source: input.image.kind },
    }),
    schema: modelDraftSchema,
    request: {
      max_tokens: 1500,
      system: cachedSystem(listingSystemPrompt(taxonomy)),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: `The shop sells in ${COUNTRY_NAMES[country]}. Draft the listing.` },
          ],
        },
      ],
    },
  });

  if (!result.ok) {
    if (result.reason === "not_configured") {
      return { ok: false, reason: "not_configured", message: "Drafting from a photo is not set up yet." };
    }
    if (result.reason === "budget_exceeded") {
      return {
        ok: false,
        reason: "budget_exceeded",
        message: "You have used this month's AI allowance. It resets on the 1st.",
      };
    }
    return { ok: false, reason: "failed", message: "We could not draft this listing. Try another photo." };
  }

  const draft = result.data;
  // Anything outside the real taxonomy is dropped, not trusted.
  const category = taxonomy.find((candidate) => candidate.id === draft.categoryId) ?? null;
  return {
    ok: true,
    draft: {
      title: draft.title,
      description: draft.description,
      descriptionLocal: draft.descriptionLocal ?? null,
      category,
      attributes: draft.attributes,
      variantSuggestions: draft.variantSuggestions,
      tags: draft.tags.map((tag) => tag.toLowerCase()),
      price: await suggestPrice(category, country, currency),
      status: "draft",
    },
  };
}
