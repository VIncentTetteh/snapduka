import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { MAX_REPLY_LENGTH, replyAsSeller } from "@/lib/whatsapp/inbox";

/**
 * Send a free-form reply as the shop.
 *
 *   POST /api/mobile/v1/inbox/{conversationId}/reply  { text }
 *   200 { message: { wamid } }        — sent; the conversation is now in human mode for 12h
 *   409 conflict, fields.window = "closed" — the buyer's 24h window has closed:
 *       WhatsApp only allows approved templates now; show that instead of the box
 *   409 conflict, fields.whatsapp = "not_configured" — WhatsApp is not set up
 *   403 forbidden — role lacks orders.manage, or wa_outbound is off
 *   404 not_found
 */

const schema = z.object({ text: z.string().trim().min(1).max(MAX_REPLY_LENGTH) });

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireSeller("orders.manage");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("inbox.reply", actor.sellerAccountId, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  const { conversationId } = await context.params;
  try {
    const result = await replyAsSeller({
      sellerAccountId: actor.sellerAccountId,
      userId: actor.userId,
      conversationId,
      text: body.text,
    });
    if (result.ok) return ok({ message: { wamid: result.wamid } });
    switch (result.reason) {
      case "not_found":
        return fail("not_found", "That conversation does not exist.");
      case "not_enabled":
        return fail("forbidden", "WhatsApp replies are not available on your shop yet.");
      case "window_closed":
        return fail(
          "conflict",
          "It has been more than 24 hours since the buyer's last message. WhatsApp only allows approved templates now.",
          { fields: { window: "closed" } },
        );
      case "not_configured":
        return fail("conflict", "WhatsApp is not set up yet.", { fields: { whatsapp: "not_configured" } });
      case "failed":
        return fail("internal", "WhatsApp did not accept the message. Try again.");
    }
  } catch (error) {
    return failUnexpected("inbox.reply", error);
  }
}
