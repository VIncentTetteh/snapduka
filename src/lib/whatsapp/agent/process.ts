import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { CurrencyCode } from "@snapduka/core";

import { AI_MODELS, cachedSystem, modelCaller } from "@/lib/ai/client";
import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

import { loadWhatsAppCloudConfig } from "../config";
import { downloadGraphMedia } from "../graph";
import { notifySellerDevices, setHumanMode } from "../handoff";
import { sendFreeFormMessage } from "../outbound";
import { getTranscriber, isTranscriberConfigured } from "../transcriber";
import { catalogSummary, createToolBackend, type AgentBinding } from "./backend";
import { classifyMessage, isHandoffKeyword, shouldHandOff, type Language } from "./classifier";
import { runAgentTurn } from "./loop";
import {
  UNSUPPORTED_MEDIA_MESSAGE,
  WHICH_SHOP_MESSAGE,
  agentSystemPrompt,
  disclosure,
  handoffMessage,
  offTopicMessage,
  voiceNotSupportedMessage,
} from "./prompt";

/**
 * What happens after a buyer's WhatsApp message is stored: the handler for
 * `whatsapp.inbound`.
 *
 * Idempotent by construction. The work unit is "every inbound message in this
 * conversation not yet handled", claimed under a per-conversation lease, and
 * each message is stamped `agent_handled_at` when its turn is done — so a
 * redelivered event, or a second event for a message the first turn already
 * covered, finds nothing to do. Three quick messages ("hi" / "do you have" /
 * "size 42") become one reply, not three.
 *
 * Order of decisions, cheapest and safest first: unbound → which shop;
 * agent off / human / paused → leave it to the seller; the buyer asked for a
 * person → hand off without asking a model; voice or media → say what we can
 * read; then the Haiku classifier; then the Sonnet turn.
 */

const LEASE_SECONDS = 90;
const PENDING_LIMIT = 10;
const HISTORY_LIMIT = 20;
/** Do not re-ask "which shop?" on every message of a burst. */
const WHICH_SHOP_COOLDOWN_MS = 5 * 60 * 1000;
/** Do not push the seller for every message of a burst either. */
const SELLER_PUSH_QUIET_MS = 10 * 60 * 1000;

export type ProcessOutcome =
  | "gone"
  | "nothing_pending"
  | "asked_for_shop"
  | "agent_off"
  | "human"
  | "paused"
  | "handed_off"
  | "voice_unsupported"
  | "media_unsupported"
  | "off_topic"
  | "replied"
  | "send_failed";

/** Thrown so the outbox retries the event once the other worker is done. */
export class ConversationBusyError extends Error {
  constructor() {
    super("conversation_busy");
  }
}

type Conversation = {
  id: string;
  buyer_phone: string;
  seller_account_id: string | null;
  mode: string;
  human_until: string | null;
  language: string | null;
  disclosed_at: string | null;
  last_outbound_at: string | null;
};

type StoredMessage = {
  id: string;
  direction: string;
  type: string;
  body: string;
  media_id: string | null;
  media_mime: string | null;
  author: string;
  created_at: string;
  agent_handled_at: string | null;
};

function asLanguage(value: string | null): Language {
  return value === "pcm" || value === "tw" ? value : "en";
}

async function markHandled(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const { error } = await createAdminClient()
    .from("wa_messages")
    .update({ agent_handled_at: new Date().toISOString() })
    .in("id", messageIds);
  if (error) throw new Error(`Could not mark messages handled: ${error.message}`);
}

async function loadHistory(conversationId: string): Promise<StoredMessage[]> {
  const { data, error } = await createAdminClient()
    .from("wa_messages")
    .select("id,direction,type,body,media_id,media_mime,author,created_at,agent_handled_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  return (data ?? []).reverse();
}

/**
 * Stored messages as model turns. The buyer is `user`; everything we sent —
 * agent, seller or system — is `assistant`, so the model sees what the buyer
 * saw. Must start with the buyer.
 */
export function toModelHistory(messages: StoredMessage[], pendingText: string): Anthropic.MessageParam[] {
  const turns: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    const text = message.body.trim() || `[${message.type}]`;
    const role = message.direction === "inbound" ? "user" : "assistant";
    if (turns.length === 0 && role === "assistant") continue;
    turns.push({ role, content: message.author === "seller" ? `[shop staff] ${text}` : text });
  }
  // A transcribed voice note replaces its "[voice]" placeholder.
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    turns.push({ role: "user", content: pendingText });
  } else if (pendingText) {
    turns[turns.length - 1] = { role: "user", content: pendingText };
  }
  return turns;
}

async function send(conversation: Conversation, text: string): Promise<boolean> {
  const result = await sendFreeFormMessage({
    to: conversation.buyer_phone,
    text,
    sellerAccountId: conversation.seller_account_id,
    conversationId: conversation.id,
    author: "agent",
  });
  if (!result.delivered) console.error(`[whatsapp/agent] reply not sent: ${result.reason}`);
  return result.delivered;
}

async function maybeNotifySeller(conversation: Conversation, history: StoredMessage[], pendingIds: Set<string>, preview: string) {
  if (!conversation.seller_account_id) return;
  const previous = history.filter((message) => message.direction === "inbound" && !pendingIds.has(message.id)).at(-1);
  if (previous && Date.now() - new Date(previous.created_at).getTime() < SELLER_PUSH_QUIET_MS) return;
  await notifySellerDevices({
    sellerAccountId: conversation.seller_account_id,
    conversationId: conversation.id,
    title: "New WhatsApp message",
    body: preview || "A buyer sent you a message.",
  });
}

async function handOff(conversation: Conversation, language: Language, reason: string, preview: string): Promise<void> {
  const sellerAccountId = conversation.seller_account_id;
  if (!sellerAccountId) return;
  const wasAlreadyHuman = conversation.mode === "human";
  await setHumanMode({ conversationId: conversation.id, sellerAccountId });
  if (!wasAlreadyHuman) await send(conversation, handoffMessage(language));
  await notifySellerDevices({
    sellerAccountId,
    conversationId: conversation.id,
    title: "A buyer needs you on WhatsApp",
    body: preview || reason,
  });
}

async function transcribeVoice(message: StoredMessage, language: Language): Promise<string | null> {
  const config = await loadWhatsAppCloudConfig();
  if (!config || !message.media_id || !isTranscriberConfigured()) return null;
  const media = await downloadGraphMedia(config, message.media_id);
  if (!media) return null;
  const result = await getTranscriber().transcribe({
    audio: media.bytes,
    mimeType: message.media_mime ?? media.mimeType,
    languageHint: language,
  });
  return result.ok ? result.text : null;
}

async function loadBinding(conversation: Conversation & { seller_account_id: string }): Promise<AgentBinding | null> {
  const { data: shop } = await createAdminClient()
    .from("shops")
    .select("id,slug,slug_code,display_name,currency")
    .eq("seller_account_id", conversation.seller_account_id)
    .maybeSingle();
  if (!shop) return null;
  return {
    sellerAccountId: conversation.seller_account_id,
    buyerPhone: conversation.buyer_phone,
    shop: {
      id: shop.id,
      slug: shop.slug,
      slugCode: shop.slug_code,
      displayName: shop.display_name,
      currency: shop.currency as CurrencyCode,
    },
  };
}

export async function processConversation(conversationId: string): Promise<ProcessOutcome> {
  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("wa_conversations")
    .select("id,buyer_phone,seller_account_id,mode,human_until,language,disclosed_at,last_outbound_at")
    .eq("id", conversationId)
    .maybeSingle();
  // Folded into a bound conversation since the event was emitted; that
  // conversation's own event covers the message.
  if (!conversation) return "gone";

  const { data: claimed, error: claimError } = await admin.rpc("wa_claim_conversation", {
    p_conversation_id: conversationId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimError) throw new Error(`Could not claim the conversation: ${claimError.message}`);
  if (!claimed) throw new ConversationBusyError();

  try {
    return await processClaimed(conversation);
  } finally {
    await admin.rpc("wa_release_conversation", { p_conversation_id: conversationId });
  }
}

async function processClaimed(conversation: Conversation): Promise<ProcessOutcome> {
  const history = await loadHistory(conversation.id);
  const pending = history
    .filter((message) => message.direction === "inbound" && !message.agent_handled_at)
    .slice(-PENDING_LIMIT);
  if (pending.length === 0) return "nothing_pending";
  const pendingIds = new Set(pending.map((message) => message.id));
  const done = () => markHandled([...pendingIds]);
  const pendingText = pending.map((message) => message.body.trim()).filter(Boolean).join("\n");
  const preview = pendingText.slice(0, 140);
  let language = asLanguage(conversation.language);

  // 1. No shop yet: ask, without any model.
  const sellerAccountId = conversation.seller_account_id;
  if (!sellerAccountId) {
    // No seller to evaluate against, so only the global wa_agent row counts:
    // "which shop?" goes out only once the agent is on for everyone.
    if (!(await isFeatureEnabled("wa_agent"))) {
      await done();
      return "agent_off";
    }
    const lastAsked = conversation.last_outbound_at ? new Date(conversation.last_outbound_at).getTime() : 0;
    if (Date.now() - lastAsked > WHICH_SHOP_COOLDOWN_MS) await send(conversation, WHICH_SHOP_MESSAGE);
    await done();
    return "asked_for_shop";
  }
  const bound = { ...conversation, seller_account_id: sellerAccountId };

  // 2. Is the agent allowed to answer at all?
  if (!(await isFeatureEnabled("wa_agent", { sellerAccountId }))) {
    await maybeNotifySeller(conversation, history, pendingIds, preview);
    await done();
    return "agent_off";
  }
  if (conversation.mode === "paused") {
    await maybeNotifySeller(conversation, history, pendingIds, preview);
    await done();
    return "paused";
  }
  if (conversation.mode === "human") {
    if (conversation.human_until && new Date(conversation.human_until).getTime() > Date.now()) {
      await maybeNotifySeller(conversation, history, pendingIds, preview);
      await done();
      return "human";
    }
    // The takeover lapsed: the agent is back.
    await createAdminClient()
      .from("wa_conversations")
      .update({ mode: "agent", human_until: null })
      .eq("id", conversation.id)
      .eq("seller_account_id", sellerAccountId);
    conversation.mode = "agent";
  }

  // 3. "HUMAN" is honoured without asking any model.
  if (pending.some((message) => isHandoffKeyword(message.body))) {
    await handOff(conversation, language, "The buyer asked for a person.", preview);
    await done();
    return "handed_off";
  }

  // 4. Voice notes and media.
  let text = pendingText;
  const voice = pending.filter((message) => message.type === "voice" || message.type === "audio");
  if (voice.length > 0 && (await isFeatureEnabled("wa_agent_voice", { sellerAccountId }))) {
    const transcripts = await Promise.all(voice.map((message) => transcribeVoice(message, language)));
    text = [text, ...transcripts.filter((value): value is string => Boolean(value))].filter(Boolean).join("\n");
  }
  if (!text) {
    await send(conversation, voice.length > 0 ? voiceNotSupportedMessage(language) : UNSUPPORTED_MEDIA_MESSAGE);
    await done();
    return voice.length > 0 ? "voice_unsupported" : "media_unsupported";
  }

  // 5. Classify (Haiku; heuristic if the model is unavailable).
  const classification = await classifyMessage(
    modelCaller({ sellerAccountId, purpose: "wa.classify", model: AI_MODELS.fast, context: { conversationId: conversation.id } }),
    text,
  );
  language = classification.language;
  if (language !== conversation.language) {
    await createAdminClient().from("wa_conversations").update({ language }).eq("id", conversation.id);
  }
  if (shouldHandOff(classification)) {
    await handOff(conversation, language, `Needs a person (${classification.intent}).`, preview);
    await done();
    return "handed_off";
  }
  if (classification.intent === "off_topic") {
    await send(conversation, offTopicMessage(language));
    await done();
    return "off_topic";
  }

  // 6. The agent turn (Sonnet, tools bound to this seller and buyer).
  const binding = await loadBinding(bound);
  if (!binding) {
    await handOff(conversation, language, "The shop could not be loaded.", preview);
    await done();
    return "handed_off";
  }
  const summary = await catalogSummary(binding);
  const turn = await runAgentTurn({
    call: modelCaller({ sellerAccountId, purpose: "wa.agent", model: AI_MODELS.agent, context: { conversationId: conversation.id } }),
    system: cachedSystem(
      agentSystemPrompt({ shopName: binding.shop.displayName, currency: binding.shop.currency, catalogSummary: summary.text }),
    ),
    history: toModelHistory(history, text),
    backend: createToolBackend(binding),
    catalogPrices: summary.prices,
  });

  if (turn.kind !== "reply") {
    // Budget spent, AI down, a guardrail tripped, or the model asked for a
    // person: in every case the buyer is told a person is coming, and one is.
    const reason = turn.kind === "handoff" ? turn.reason : `AI unavailable (${turn.reason}).`;
    await handOff(conversation, language, reason, preview);
    await done();
    return "handed_off";
  }

  const firstReply = !conversation.disclosed_at;
  const reply = firstReply ? `${disclosure(language, binding.shop.displayName)}\n\n${turn.text}` : turn.text;
  const sent = await send(conversation, reply);
  if (sent && firstReply) {
    await createAdminClient()
      .from("wa_conversations")
      .update({ disclosed_at: new Date().toISOString() })
      .eq("id", conversation.id);
  }
  await done();
  return sent ? "replied" : "send_failed";
}
