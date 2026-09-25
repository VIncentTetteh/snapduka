import "server-only";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

import { HUMAN_TAKEOVER_MS, setHumanMode } from "./handoff";
import { isWithinServiceWindow, sendFreeFormMessage } from "./outbound";

/**
 * The seller's WhatsApp inbox, shared by the web page and the mobile API so
 * both clients see the same rules.
 *
 * Every query runs on the service-role client with an explicit
 * `seller_account_id` filter — the wa_* tables are not readable with a user's
 * JWT at all, so this module *is* the tenant boundary, and every function
 * takes the seller id from the resolved actor, never from the request.
 *
 * Lists page by keyset (last_message_at, id), never by offset: new messages
 * reorder the list continuously, and offsets would skip or repeat threads.
 */

export const CONVERSATION_PAGE = 30;
export const MESSAGE_PAGE = 50;

export type ConversationMode = "agent" | "human" | "paused";

export type InboxConversation = {
  id: string;
  buyerPhone: string;
  mode: ConversationMode;
  humanUntil: string | null;
  assignedMemberId: string | null;
  language: "en" | "pcm" | "tw" | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  preview: string;
  unreadCount: number;
  /** Whether a free-form reply is allowed right now (Meta's 24h window). */
  windowOpen: boolean;
};

export type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  author: "buyer" | "agent" | "seller" | "system";
  type: string;
  body: string;
  templateName: string | null;
  status: string;
  createdAt: string;
};

type Cursor = { at: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "at" in parsed &&
      "id" in parsed &&
      typeof parsed.at === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.at)) &&
      /^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      return { at: new Date(parsed.at).toISOString(), id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

/** PostgREST keyset condition "strictly before (at, id)" in descending order. */
function beforeFilter(column: string, cursor: Cursor): string {
  return `${column}.lt."${cursor.at}",and(${column}.eq."${cursor.at}",id.lt.${cursor.id})`;
}

const CONVERSATION_COLUMNS =
  "id,buyer_phone,mode,human_until,assigned_member_id,language,last_message_at,last_inbound_at,last_message_preview,unread_count";

type ConversationRow = {
  id: string;
  buyer_phone: string;
  mode: string;
  human_until: string | null;
  assigned_member_id: string | null;
  language: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  last_message_preview: string;
  unread_count: number;
};

function toConversation(row: ConversationRow, now = new Date()): InboxConversation {
  return {
    id: row.id,
    buyerPhone: row.buyer_phone,
    mode: row.mode === "human" || row.mode === "paused" ? row.mode : "agent",
    humanUntil: row.human_until,
    assignedMemberId: row.assigned_member_id,
    language: row.language === "en" || row.language === "pcm" || row.language === "tw" ? row.language : null,
    lastMessageAt: row.last_message_at,
    lastInboundAt: row.last_inbound_at,
    preview: row.last_message_preview,
    unreadCount: row.unread_count,
    windowOpen: isWithinServiceWindow(row.last_inbound_at, now),
  };
}

export async function listConversations(
  sellerAccountId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ conversations: InboxConversation[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? CONVERSATION_PAGE, 1), 100);
  const cursor = decodeCursor(options.cursor);
  let query = createAdminClient()
    .from("wa_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("seller_account_id", sellerAccountId)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) query = query.or(beforeFilter("last_message_at", cursor));
  const { data, error } = await query;
  if (error) throw new Error(`Could not load conversations: ${error.message}`);

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    conversations: page.map((row) => toConversation(row)),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.last_message_at, id: last.id }) : null,
  };
}

async function ownConversation(sellerAccountId: string, conversationId: string): Promise<ConversationRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const { data, error } = await createAdminClient()
    .from("wa_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  return data;
}

export async function getThread(
  sellerAccountId: string,
  conversationId: string,
  options: { before?: string | null; limit?: number; markRead?: boolean } = {},
): Promise<{ conversation: InboxConversation; messages: InboxMessage[]; nextBefore: string | null } | null> {
  const conversation = await ownConversation(sellerAccountId, conversationId);
  if (!conversation) return null;

  const limit = Math.min(Math.max(options.limit ?? MESSAGE_PAGE, 1), 100);
  const before = decodeCursor(options.before);
  const admin = createAdminClient();
  let query = admin
    .from("wa_messages")
    .select("id,direction,author,type,body,template_name,status,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (before) query = query.or(beforeFilter("created_at", before));
  const { data, error } = await query;
  if (error) throw new Error(`Could not load messages: ${error.message}`);

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);

  if (options.markRead !== false && conversation.unread_count > 0) {
    await admin
      .from("wa_conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .eq("seller_account_id", sellerAccountId);
    conversation.unread_count = 0;
  }

  return {
    conversation: toConversation(conversation),
    messages: page.reverse().map((row) => ({
      id: row.id,
      direction: row.direction === "inbound" ? "inbound" : "outbound",
      author:
        row.author === "buyer" || row.author === "agent" || row.author === "seller" ? row.author : "system",
      type: row.type,
      body: row.body,
      templateName: row.template_name,
      status: row.status,
      createdAt: row.created_at,
    })),
    nextBefore: rows.length > limit && oldest ? encodeCursor({ at: oldest.created_at, id: oldest.id }) : null,
  };
}

/** The team_memberships row of a team member, for `assigned_member_id`. */
export async function memberIdFor(sellerAccountId: string, userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("team_memberships")
    .select("id")
    .eq("seller_account_id", sellerAccountId)
    .eq("auth_user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return data?.id ?? null;
}

export type ReplyResult =
  | { ok: true; wamid: string }
  | { ok: false; reason: "not_found" | "not_enabled" | "window_closed" | "not_configured" | "failed" };

export const MAX_REPLY_LENGTH = 4096;

/**
 * A seller's reply. Free-form only inside the buyer's 24h window; outside it
 * the caller is told `window_closed` and should offer a template instead (none
 * is sent automatically — which template fits is the seller's call). Replying
 * takes the conversation over from the agent for 12 hours.
 */
export async function replyAsSeller(input: {
  sellerAccountId: string;
  userId: string;
  conversationId: string;
  text: string;
}): Promise<ReplyResult> {
  const conversation = await ownConversation(input.sellerAccountId, input.conversationId);
  if (!conversation) return { ok: false, reason: "not_found" };
  if (!(await isFeatureEnabled("wa_outbound", { sellerAccountId: input.sellerAccountId }))) {
    return { ok: false, reason: "not_enabled" };
  }
  if (!isWithinServiceWindow(conversation.last_inbound_at)) return { ok: false, reason: "window_closed" };

  const result = await sendFreeFormMessage({
    to: conversation.buyer_phone,
    text: input.text.slice(0, MAX_REPLY_LENGTH),
    sellerAccountId: input.sellerAccountId,
    conversationId: conversation.id,
    author: "seller",
    authorUserId: input.userId,
  });
  if (!result.delivered) {
    if (result.reason === "outside_window") return { ok: false, reason: "window_closed" };
    if (result.reason === "not_configured") return { ok: false, reason: "not_configured" };
    return { ok: false, reason: "failed" };
  }

  // The seller is talking now; the agent stands back.
  await setHumanMode({
    conversationId: conversation.id,
    sellerAccountId: input.sellerAccountId,
    assignedMemberId: await memberIdFor(input.sellerAccountId, input.userId),
  });
  return { ok: true, wamid: result.wamid };
}

/**
 * Take over (human, 12h), hand back to the agent, or pause automatic replies
 * entirely. Handing back clears the assignee so the next takeover is fresh.
 */
export async function setConversationMode(input: {
  sellerAccountId: string;
  userId: string;
  conversationId: string;
  mode: ConversationMode;
  now?: Date;
}): Promise<InboxConversation | null> {
  const conversation = await ownConversation(input.sellerAccountId, input.conversationId);
  if (!conversation) return null;
  const now = input.now ?? new Date();

  const values =
    input.mode === "human"
      ? {
          mode: "human",
          human_until: new Date(now.getTime() + HUMAN_TAKEOVER_MS).toISOString(),
          assigned_member_id: await memberIdFor(input.sellerAccountId, input.userId),
        }
      : { mode: input.mode, human_until: null, assigned_member_id: null };

  const { data, error } = await createAdminClient()
    .from("wa_conversations")
    .update(values)
    .eq("id", input.conversationId)
    .eq("seller_account_id", input.sellerAccountId)
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not change the conversation mode: ${error.message}`);
  return data ? toConversation(data, now) : null;
}
