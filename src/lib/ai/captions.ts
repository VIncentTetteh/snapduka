import "server-only";

import { formatMoney } from "@snapduka/core";
import { z } from "zod";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { unverifiedPrices } from "@/lib/whatsapp/agent/guardrails";

import { AI_MODELS, cachedSystem, modelCaller } from "./client";
import { generateStructured } from "./structured";

/**
 * Caption suggestions for the share / story card (flag `ai_captions`).
 *
 * Haiku: three short options per request, cheap enough to regenerate. The
 * seller picks and edits one; nothing is posted from here.
 *
 * Two rules enforced on the output, not just asked for in the prompt:
 *  - no price except the product's own (a caption saying "only GH₵50!" for a
 *    GH₵80 product is a promise the seller never made);
 *  - no links — the card attaches its own tracked link, and a model-written
 *    URL would bypass attribution or point somewhere else entirely.
 */

export const CAPTION_CHANNELS = ["whatsapp", "instagram", "tiktok", "snapchat"] as const;
export type CaptionChannel = (typeof CAPTION_CHANNELS)[number];
export type CaptionLanguage = "en" | "pcm" | "tw";

const captionsSchema = z.object({
  captions: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
});

export type CaptionResult =
  | { ok: true; captions: string[] }
  | { ok: false; reason: "not_enabled" | "not_found" | "not_configured" | "budget_exceeded" | "failed"; message: string };

const SYSTEM = [
  "You write short social media captions for small shops in Ghana and Nigeria selling on WhatsApp, Instagram, TikTok and Snapchat.",
  "Write exactly three different captions. Each under 220 characters, warm and specific to the product, at most two emoji, no hashtag walls (at most two hashtags, none for WhatsApp).",
  "Only use facts from the product details given. Never invent discounts, stock levels, delivery promises or prices. If you mention a price, use exactly the price given.",
  "Never include links or URLs; the shop adds its own link.",
  "Language: en = English, pcm = Nigerian/Ghanaian Pidgin, tw = Twi. Write in the requested language.",
  'Reply with only JSON: {"captions": [string, string, string]}',
].join("\n");

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|shop|store|gh|ng|link|ly)\b/i;

/** Captions that break the rules are dropped, not repaired. */
export function acceptableCaptions(captions: string[], allowedPrices: string[]): string[] {
  return captions
    .map((caption) => caption.replace(/\s+/g, " ").trim())
    .filter((caption) => caption.length > 0 && !URL_PATTERN.test(caption))
    .filter((caption) => unverifiedPrices(caption, allowedPrices).length === 0)
    .slice(0, 3);
}

export async function suggestCaptions(input: {
  sellerAccountId: string;
  productId: string;
  channel: CaptionChannel;
  language?: CaptionLanguage;
}): Promise<CaptionResult> {
  if (!(await isFeatureEnabled("ai_captions", { sellerAccountId: input.sellerAccountId }))) {
    return { ok: false, reason: "not_enabled", message: "Caption suggestions are not available on your shop yet." };
  }

  const { data: product } = await createAdminClient()
    .from("products")
    .select("name,description,price_minor,compare_at_price_minor,currency")
    .eq("id", input.productId)
    .eq("seller_account_id", input.sellerAccountId)
    .maybeSingle();
  if (!product) return { ok: false, reason: "not_found", message: "That product does not exist." };

  const price = formatMoney(product.price_minor, product.currency);
  const details = [
    `Product: ${product.name}`,
    `Price: ${price}`,
    product.compare_at_price_minor ? `Was: ${formatMoney(product.compare_at_price_minor, product.currency)}` : null,
    product.description ? `Description: ${product.description.slice(0, 800)}` : null,
    `Channel: ${input.channel}`,
    `Language: ${input.language ?? "en"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generateStructured({
    call: modelCaller({
      sellerAccountId: input.sellerAccountId,
      purpose: "share.captions",
      model: AI_MODELS.fast,
      context: { productId: input.productId, channel: input.channel },
    }),
    schema: captionsSchema,
    request: { max_tokens: 600, system: cachedSystem(SYSTEM), messages: [{ role: "user", content: details }] },
  });

  if (!result.ok) {
    if (result.reason === "not_configured") {
      return { ok: false, reason: "not_configured", message: "Caption suggestions are not set up yet." };
    }
    if (result.reason === "budget_exceeded") {
      return { ok: false, reason: "budget_exceeded", message: "You have used this month's AI allowance." };
    }
    return { ok: false, reason: "failed", message: "Could not suggest captions. Try again." };
  }

  const allowedPrices = [
    price,
    ...(product.compare_at_price_minor ? [formatMoney(product.compare_at_price_minor, product.currency)] : []),
  ];
  const captions = acceptableCaptions(result.data.captions, allowedPrices);
  if (captions.length === 0) {
    return { ok: false, reason: "failed", message: "Could not suggest captions. Try again." };
  }
  return { ok: true, captions };
}
