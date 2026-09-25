import "server-only";

import { sendPush } from "@/lib/notifications/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Putting a person in the conversation.
 *
 * Human mode lasts HUMAN_TAKEOVER_MS (12h) and then lapses back to the agent,
 * so a seller who replied once and went to bed does not leave the buyer
 * talking to nobody for a week. Every entry into human mode pushes the seller's
 * devices through the existing Expo path — a handoff nobody hears about is
 * worse than no handoff, because the buyer was told someone is coming.
 */

export const HUMAN_TAKEOVER_MS = 12 * 60 * 60 * 1000;
const MAX_DEVICES = 10;

export async function setHumanMode(input: {
  conversationId: string;
  sellerAccountId: string;
  assignedMemberId?: string | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const { error } = await createAdminClient()
    .from("wa_conversations")
    .update({
      mode: "human",
      human_until: new Date(now.getTime() + HUMAN_TAKEOVER_MS).toISOString(),
      ...(input.assignedMemberId !== undefined ? { assigned_member_id: input.assignedMemberId } : {}),
    })
    .eq("id", input.conversationId)
    .eq("seller_account_id", input.sellerAccountId);
  if (error) throw new Error(`Could not hand the conversation to the shop: ${error.message}`);
}

/**
 * Push every active device of the seller's account. Best-effort per device:
 * one dead token must not stop the others hearing about it.
 */
export async function notifySellerDevices(input: {
  sellerAccountId: string;
  conversationId: string;
  title: string;
  body: string;
}): Promise<number> {
  const { data: devices, error } = await createAdminClient()
    .from("device_push_tokens")
    .select("expo_push_token")
    .eq("seller_account_id", input.sellerAccountId)
    .eq("active", true)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_DEVICES);
  if (error) {
    console.error("[whatsapp/handoff] could not load seller devices", error.message);
    return 0;
  }
  let delivered = 0;
  for (const device of devices ?? []) {
    try {
      const result = await sendPush(device.expo_push_token, input.title, input.body.slice(0, 140), undefined, {
        type: "whatsapp_conversation",
        conversationId: input.conversationId,
      });
      if (result.delivered) delivered += 1;
    } catch (cause) {
      console.error("[whatsapp/handoff] push failed", cause);
    }
  }
  return delivered;
}
