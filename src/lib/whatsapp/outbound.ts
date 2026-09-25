import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { loadWhatsAppCloudConfig, toE164 } from "./config";
import { sendGraphTemplate, sendGraphText, type GraphSendResult } from "./graph";
import { WA_TEMPLATES, storableTemplateBody, type WaTemplateCall } from "./templates";

/**
 * Every outbound WhatsApp message goes through here: order notifications,
 * agent replies, seller replies from the inbox. It owns the one rule Meta
 * enforces hardest — free-form text only within 24 hours of the buyer's last
 * message, approved templates otherwise — and records what was sent, so the
 * inbox shows the seller the same thread the buyer sees.
 */

/** Meta's customer-service window. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type OutboundFailure =
  | "not_configured"
  | "invalid_recipient"
  | "outside_window"
  | "template_not_approved"
  | "auth_failed"
  | "rejected";

export type OutboundResult =
  | { delivered: true; wamid: string }
  | { delivered: false; reason: OutboundFailure };

export type OutboundAuthor = "agent" | "seller" | "system";

export function isWithinServiceWindow(lastInboundAt: string | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  return Number.isFinite(at) && now.getTime() - at < SERVICE_WINDOW_MS;
}

/**
 * The buyer's last message to us from this phone, across every shop. Meta's
 * window belongs to the (buyer, business number) pair and SnapDuka has one
 * shared number, so a message the buyer sent to shop A opens the window for a
 * reply about shop B too.
 */
export async function lastInboundAt(e164: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("wa_conversations")
    .select("last_inbound_at")
    .eq("buyer_phone", e164)
    .not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the WhatsApp window: ${error.message}`);
  return data?.last_inbound_at ?? null;
}

async function isTemplateApproved(call: WaTemplateCall): Promise<boolean> {
  const definition = WA_TEMPLATES[call.name];
  const { data, error } = await createAdminClient()
    .from("wa_templates")
    .select("status")
    .eq("name", definition.name)
    .eq("language", definition.language)
    .maybeSingle();
  if (error) throw new Error(`Could not read the WhatsApp template registry: ${error.message}`);
  return data?.status === "approved";
}

async function record(input: {
  to: string;
  sellerAccountId: string | null;
  conversationId?: string | null;
  result: GraphSendResult;
  type: "text" | "template";
  body: string;
  templateName?: string;
  author: OutboundAuthor;
  authorUserId?: string | null;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("wa_record_outbound", {
    p_buyer_phone: input.to,
    p_seller_account_id: input.sellerAccountId ?? undefined,
    p_wamid: input.result.ok ? input.result.wamid : undefined,
    p_type: input.type,
    p_body: input.body,
    p_author: input.author,
    p_status: input.result.ok ? "sent" : "failed",
    p_template_name: input.templateName,
    p_author_user_id: input.authorUserId ?? undefined,
    p_error: input.result.ok ? undefined : `${input.result.reason} ${input.result.detail}`,
    p_conversation_id: input.conversationId ?? undefined,
  });
  // The message has already gone (or failed) at Meta; a missing inbox row is a
  // display gap, not a reason to send it again.
  if (error) console.error("[whatsapp] could not record an outbound message", error);
}

function toOutcome(result: GraphSendResult): OutboundResult {
  return result.ok ? { delivered: true, wamid: result.wamid } : { delivered: false, reason: result.reason };
}

/** Free-form text. Refused outside the 24h window rather than attempted. */
export async function sendFreeFormMessage(input: {
  to: string;
  text: string;
  sellerAccountId: string | null;
  conversationId?: string | null;
  author: OutboundAuthor;
  authorUserId?: string | null;
  now?: Date;
}): Promise<OutboundResult> {
  const config = await loadWhatsAppCloudConfig();
  if (!config) return { delivered: false, reason: "not_configured" };
  const to = toE164(input.to);
  if (!to) return { delivered: false, reason: "invalid_recipient" };
  if (!isWithinServiceWindow(await lastInboundAt(to), input.now)) {
    return { delivered: false, reason: "outside_window" };
  }

  const result = await sendGraphText(config, to, input.text);
  await record({ ...input, to, result, type: "text", body: input.text });
  return toOutcome(result);
}

/**
 * An approved template, allowed at any time. Only templates whose approval is
 * recorded in `wa_templates` are attempted: a template Meta rejects is a
 * notification that never arrives, found out only when a buyer complains.
 */
export async function sendTemplateMessage(input: {
  to: string;
  call: WaTemplateCall;
  sellerAccountId: string | null;
  conversationId?: string | null;
  author: OutboundAuthor;
  authorUserId?: string | null;
}): Promise<OutboundResult> {
  const config = await loadWhatsAppCloudConfig();
  if (!config) return { delivered: false, reason: "not_configured" };
  const to = toE164(input.to);
  if (!to) return { delivered: false, reason: "invalid_recipient" };
  if (!(await isTemplateApproved(input.call))) return { delivered: false, reason: "template_not_approved" };

  const result = await sendGraphTemplate(config, to, input.call);
  // A message to the seller themselves (payout_sent) is not a buyer
  // conversation and does not belong in the seller's inbox.
  if (WA_TEMPLATES[input.call.name].audience === "buyer") {
    await record({
      ...input,
      to,
      result,
      type: "template",
      body: storableTemplateBody(input.call),
      templateName: input.call.name,
    });
  }
  return toOutcome(result);
}
