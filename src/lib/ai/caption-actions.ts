"use server";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit";

import { CAPTION_CHANNELS, suggestCaptions, type CaptionChannel, type CaptionLanguage, type CaptionResult } from "./captions";

/**
 * Web entry point for caption suggestions, for the Share Studio card to call.
 * Same rules as the mobile route: campaigns.manage, flag `ai_captions`, rate
 * limited, and nothing is posted — the seller picks and edits a suggestion.
 */
export async function suggestCaptionsAction(input: {
  productId: string;
  channel: CaptionChannel;
  language?: CaptionLanguage;
}): Promise<CaptionResult> {
  const actor = await resolveServerActor();
  if (
    actor.kind !== "seller" ||
    !hasPermission(actor.role ?? "owner", "campaigns.manage") ||
    !["pending", "active"].includes(actor.status)
  ) {
    return { ok: false, reason: "not_enabled", message: "Your role does not allow this." };
  }
  if (!(CAPTION_CHANNELS as readonly string[]).includes(input.channel) || !/^[0-9a-f-]{36}$/i.test(input.productId)) {
    return { ok: false, reason: "not_found", message: "That product does not exist." };
  }
  const limited = await checkRateLimit(`web:ai.caption:${actor.sellerAccountId}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) return { ok: false, reason: "failed", message: "Too many requests. Try again shortly." };

  return suggestCaptions({
    sellerAccountId: actor.sellerAccountId,
    productId: input.productId,
    channel: input.channel,
    language: input.language === "pcm" || input.language === "tw" ? input.language : "en",
  });
}
