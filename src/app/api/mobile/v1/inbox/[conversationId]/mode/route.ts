import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { setConversationMode } from "@/lib/whatsapp/inbox";

/**
 * Take over from the assistant, hand back, or pause automatic replies.
 *
 *   POST /api/mobile/v1/inbox/{conversationId}/mode  { mode: "human" | "agent" | "paused" }
 *   200 { conversation: InboxConversation }
 *
 * "human" lasts 12 hours (humanUntil) and is assigned to the caller; "agent"
 * hands back and clears the assignee; "paused" stops automatic replies until
 * changed. Requires orders.manage.
 */

const schema = z.object({ mode: z.enum(["agent", "human", "paused"]) });

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireSeller("orders.manage");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("inbox.mode", actor.sellerAccountId, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  const { conversationId } = await context.params;
  try {
    const conversation = await setConversationMode({
      sellerAccountId: actor.sellerAccountId,
      userId: actor.userId,
      conversationId,
      mode: body.mode,
    });
    if (!conversation) return fail("not_found", "That conversation does not exist.");
    return ok({ conversation });
  } catch (error) {
    return failUnexpected("inbox.mode", error);
  }
}
