import { z } from "zod";

import { CAPTION_CHANNELS, suggestCaptions } from "@/lib/ai/captions";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Caption suggestions for the share / story card.
 *
 *   POST { productId, channel: "whatsapp"|"instagram"|"tiktok"|"snapchat", language?: "en"|"pcm"|"tw" }
 *   200  { captions: string[] }   — up to 3; the app shows them as editable options
 *   403  forbidden (role, or ai_captions off) / plan_limit (AI budget spent)
 *   404  not_found   409 conflict (AI not configured)
 *
 * Captions never contain links (the card adds its tracked link) or any price
 * but the product's own. Requires campaigns.manage, like sharing itself.
 */

const schema = z.object({
  productId: z.uuid(),
  channel: z.enum(CAPTION_CHANNELS),
  language: z.enum(["en", "pcm", "tw"]).optional(),
});

export async function POST(request: Request) {
  const actor = await requireSeller("campaigns.manage");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("ai.caption", actor.sellerAccountId, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await suggestCaptions({ sellerAccountId: actor.sellerAccountId, ...body });
    if (result.ok) return ok({ captions: result.captions });
    switch (result.reason) {
      case "not_enabled":
        return fail("forbidden", result.message);
      case "budget_exceeded":
        return fail("plan_limit", result.message);
      case "not_found":
        return fail("not_found", result.message);
      case "not_configured":
        return fail("conflict", result.message);
      case "failed":
        return fail("internal", result.message);
    }
  } catch (error) {
    return failUnexpected("ai.caption", error);
  }
}
