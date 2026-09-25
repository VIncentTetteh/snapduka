import "server-only";

import { isFeatureEnabled } from "@/lib/flags";
import { canBroadcastWhatsApp } from "@/lib/notifications/whatsapp";

export type BroadcastChannel = "email" | "whatsapp" | "push" | "sms";

/**
 * The broadcast channels that can actually deliver for this seller. The web
 * form, the create action and the mobile app (via /api/mobile/v1/account) all
 * offer exactly these, so a seller never writes a broadcast whose every
 * delivery would fail — which is what WhatsApp and SMS did when offered
 * unconditionally.
 */
export async function broadcastChannels(sellerAccountId: string): Promise<BroadcastChannel[]> {
  const [whatsapp, sms] = await Promise.all([
    canBroadcastWhatsApp(sellerAccountId),
    // SMS stays behind its flag until opt-out (STOP) handling is live.
    isFeatureEnabled("sms_broadcasts", { sellerAccountId }),
  ]);
  const channels: BroadcastChannel[] = ["email"];
  if (whatsapp) channels.push("whatsapp");
  channels.push("push");
  if (sms) channels.push("sms");
  return channels;
}
