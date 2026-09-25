import { isFeatureEnabled } from "@/lib/flags";
import { enforceRateLimit, isResponse, requireSeller } from "@/lib/mobile/guard";
import { failUnexpected, ok } from "@/lib/mobile/response";
import { listConversations } from "@/lib/whatsapp/inbox";

/**
 * WhatsApp inbox for the seller app — the conversation list.
 *
 *   GET /api/mobile/v1/inbox?cursor=<opaque>
 *   200 { enabled: boolean, conversations: InboxConversation[], nextCursor: string | null }
 *
 * InboxConversation: { id, buyerPhone (E.164), mode: "agent"|"human"|"paused",
 * humanUntil, assignedMemberId, language: "en"|"pcm"|"tw"|null, lastMessageAt,
 * lastInboundAt, preview, unreadCount, windowOpen } — see src/lib/whatsapp/inbox.ts.
 *
 * `enabled` is the wa_outbound flag: the app hides the inbox tab while it is
 * false. Newest first; pass `nextCursor` back as `cursor` for the next page.
 * Requires customers.read.
 */
export async function GET(request: Request) {
  const actor = await requireSeller("customers.read");
  if (isResponse(actor)) return actor;
  const limited = await enforceRateLimit("inbox.list", actor.sellerAccountId, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    const [enabled, page] = await Promise.all([
      isFeatureEnabled("wa_outbound", { sellerAccountId: actor.sellerAccountId }),
      listConversations(actor.sellerAccountId, { cursor }),
    ]);
    return ok({ enabled, ...page });
  } catch (error) {
    return failUnexpected("inbox.list", error);
  }
}
