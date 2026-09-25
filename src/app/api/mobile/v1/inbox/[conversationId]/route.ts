import { enforceRateLimit, isResponse, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { getThread } from "@/lib/whatsapp/inbox";

/**
 * One conversation's messages, oldest first within the page.
 *
 *   GET /api/mobile/v1/inbox/{conversationId}?before=<opaque>
 *   200 { conversation: InboxConversation, messages: InboxMessage[], nextBefore: string | null }
 *   404 not_found — not this seller's conversation (indistinguishable from missing)
 *
 * InboxMessage: { id, direction: "inbound"|"outbound", author: "buyer"|"agent"|
 * "seller"|"system", type, body, templateName, status, createdAt }.
 * Opening a thread marks it read. Pass `nextBefore` as `before` for older
 * messages. Requires customers.read.
 */
export async function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireSeller("customers.read");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("inbox.thread", actor.sellerAccountId, { limit: 240, windowMs: 60_000 });
  if (limited) return limited;

  const { conversationId } = await context.params;
  try {
    const before = new URL(request.url).searchParams.get("before");
    const thread = await getThread(actor.sellerAccountId, conversationId, { before });
    if (!thread) return fail("not_found", "That conversation does not exist.");
    return ok(thread);
  } catch (error) {
    return failUnexpected("inbox.thread", error);
  }
}
