"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { MAX_REPLY_LENGTH, replyAsSeller, setConversationMode, type ConversationMode } from "@/lib/whatsapp/inbox";

/**
 * Inbox actions. Both refuse by redirecting back with `?error=` so the page
 * says why (ActionBanner), rather than reloading as if nothing happened.
 */

function back(conversationId: string, params: Record<string, string> = {}): never {
  const query = new URLSearchParams({ c: conversationId, ...params });
  redirect(`/dashboard/inbox?${query.toString()}`);
}

async function manager() {
  const actor = await resolveServerActor();
  // A team member resolves as kind "seller"; the role is the real check.
  if (
    actor.kind !== "seller" ||
    !hasPermission(actor.role ?? "owner", "orders.manage") ||
    !["pending", "active"].includes(actor.status)
  ) {
    return null;
  }
  return actor;
}

const REPLY_ERRORS = {
  not_found: "That conversation does not exist.",
  not_enabled: "WhatsApp replies are not available on your shop yet.",
  window_closed:
    "It has been more than 24 hours since the buyer's last message, so WhatsApp only allows approved templates. Send an order update from the order page, or wait for the buyer to message again.",
  not_configured: "WhatsApp is not set up yet.",
  failed: "WhatsApp did not accept the message. Try again.",
} as const;

export async function replyAction(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const actor = await manager();
  if (!actor) back(conversationId, { error: "Your role does not allow replying to buyers." });
  if (!text) back(conversationId, { error: "Write a message first." });
  if (text.length > MAX_REPLY_LENGTH) back(conversationId, { error: "That message is too long for WhatsApp." });

  const result = await replyAsSeller({ sellerAccountId: actor.sellerAccountId, userId: actor.userId, conversationId, text });
  revalidatePath("/dashboard/inbox");
  if (!result.ok) back(conversationId, { error: REPLY_ERRORS[result.reason] });
  back(conversationId);
}

const MODE_SAVED: Record<ConversationMode, string> = {
  human: "You have taken over this conversation for 12 hours. The assistant will not reply.",
  agent: "Handed back to the assistant.",
  paused: "Automatic replies are paused for this conversation.",
};

export async function setModeAction(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const actor = await manager();
  if (!actor) back(conversationId, { error: "Your role does not allow changing this conversation." });
  if (mode !== "agent" && mode !== "human" && mode !== "paused") back(conversationId, { error: "Unknown mode." });

  const conversation = await setConversationMode({
    sellerAccountId: actor.sellerAccountId,
    userId: actor.userId,
    conversationId,
    mode,
  });
  revalidatePath("/dashboard/inbox");
  if (!conversation) back(conversationId, { error: "That conversation does not exist." });
  back(conversationId, { saved: MODE_SAVED[mode] });
}
