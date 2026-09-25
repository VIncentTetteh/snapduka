import "server-only";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWhatsAppCloudConfig, toE164 } from "@/lib/whatsapp/config";
import {
  isWithinServiceWindow,
  lastInboundAt,
  sendFreeFormMessage,
  sendTemplateMessage,
  type OutboundAuthor,
} from "@/lib/whatsapp/outbound";
import { templateForOrderEvent, type WaTemplateCall } from "@/lib/whatsapp/templates";

export function buyerInitiatedWhatsApp(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/**
 * Whether a WhatsApp provider is wired up, without making a request.
 *
 * Mirrors isSmsConfigured. Callers need this to avoid OFFERING a channel the
 * platform cannot deliver on: the seller settings page used to show a WhatsApp
 * checkbox unconditionally, so ticking it enqueued buyer notifications that
 * could only ever dead-letter.
 *
 * True for either transport: the Cloud API (WHATSAPP_PHONE_NUMBER_ID +
 * WHATSAPP_ACCESS_TOKEN) or the legacy relay webhook.
 */
export async function isWhatsAppConfigured(): Promise<boolean> {
  // Reads Vault (cached): in production the Cloud API credentials live there,
  // and a synchronous env-only check reported WhatsApp as unconfigured.
  return Boolean(process.env.WHATSAPP_WEBHOOK_URL) || (await loadWhatsAppCloudConfig()) !== null;
}

/**
 * Whether a free-form marketing message to this seller's customers can be
 * delivered. Only the legacy relay can: through the Cloud API a broadcast is
 * free-form text, which Meta refuses outside the buyer's 24h window, and there
 * is no approved marketing template to fall back on. So with the Cloud API on
 * for the seller, WhatsApp broadcasts are not offered at all.
 */
export async function canBroadcastWhatsApp(sellerAccountId: string): Promise<boolean> {
  if (await cloudEnabled(sellerAccountId)) return false;
  return Boolean(process.env.WHATSAPP_WEBHOOK_URL);
}

/**
 * Reasons a send can never succeed on retry. The notification worker
 * dead-letters these straight away instead of spending five backed-off
 * attempts reaching the same answer.
 */
export const PERMANENT_WHATSAPP_FAILURES: ReadonlySet<string> = new Set([
  "not_configured",
  "invalid_recipient",
  "outside_window",
  "template_not_approved",
  "auth_failed",
  "rejected",
  "seller_recipient",
]);

export type WhatsAppSendResult = { delivered: boolean; reason?: string };

export type WhatsAppSendOptions = {
  /** Whose flag and whose conversation. */
  sellerAccountId?: string | null;
  /**
   * What to send instead when the buyer's 24h window has closed. Without one,
   * a closed window fails with `outside_window`.
   */
  template?: WaTemplateCall | null;
  author?: OutboundAuthor;
};

/**
 * The pre-Cloud-API transport: a relay webhook, or nothing. Kept so an
 * environment that has not moved to the Cloud API (or has `wa_outbound` off)
 * behaves exactly as it did — including dead-lettering as `not_configured`.
 */
async function sendViaLegacyWebhook(recipient: string, text: string): Promise<WhatsAppSendResult> {
  // Read into a local so the type narrows — isWhatsAppConfigured() cannot
  // narrow process.env for the caller.
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
  if (!webhookUrl) return { delivered: false, reason: "not_configured" };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: recipient, text }),
  });
  if (!response.ok) throw new Error("WhatsApp provider rejected the notification.");
  return { delivered: true };
}

async function shopName(sellerAccountId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("shops")
    .select("display_name")
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();
  return data?.display_name ?? null;
}

/** Fill `shop_name` from the seller's shop when the caller did not know it. */
async function completeTemplate(
  call: WaTemplateCall,
  sellerAccountId: string | null | undefined,
): Promise<WaTemplateCall> {
  if (call.params.shop_name || !sellerAccountId) return call;
  const name = await shopName(sellerAccountId);
  return { ...call, params: { ...call.params, shop_name: name ?? "your SnapDuka shop" } };
}

async function cloudEnabled(sellerAccountId: string | null | undefined): Promise<boolean> {
  return (
    (await loadWhatsAppCloudConfig()) !== null &&
    (await isFeatureEnabled("wa_outbound", { sellerAccountId: sellerAccountId ?? null }))
  );
}

/**
 * Send a WhatsApp message to a buyer.
 *
 * With the Cloud API configured and `wa_outbound` on: free-form text inside the
 * buyer's 24h window, `options.template` outside it, `outside_window` when
 * there is no template to fall back on. Otherwise the legacy behaviour.
 *
 * Throws only for transient failures (network, Meta 5xx, rate limits), which
 * callers retry; everything permanent comes back as `delivered: false` with a
 * reason from PERMANENT_WHATSAPP_FAILURES.
 */
export async function sendWhatsApp(
  recipient: string,
  text: string,
  options: WhatsAppSendOptions = {},
): Promise<WhatsAppSendResult> {
  if (!(await cloudEnabled(options.sellerAccountId))) return sendViaLegacyWebhook(recipient, text);

  const to = toE164(recipient);
  if (!to) return { delivered: false, reason: "invalid_recipient" };
  const author = options.author ?? "system";
  const sellerAccountId = options.sellerAccountId ?? null;

  if (isWithinServiceWindow(await lastInboundAt(to))) {
    return sendFreeFormMessage({ to, text, sellerAccountId, author });
  }
  if (!options.template) return { delivered: false, reason: "outside_window" };
  return sendTemplateMessage({
    to,
    call: await completeTemplate(options.template, sellerAccountId),
    sellerAccountId,
    author,
  });
}

/** Send an approved template regardless of the window (e.g. `payout_sent`). */
export async function sendWhatsAppTemplate(
  recipient: string,
  call: WaTemplateCall,
  options: { sellerAccountId?: string | null } = {},
): Promise<WhatsAppSendResult> {
  if (!(await cloudEnabled(options.sellerAccountId))) return { delivered: false, reason: "not_configured" };
  return sendTemplateMessage({
    to: recipient,
    call: await completeTemplate(call, options.sellerAccountId),
    sellerAccountId: options.sellerAccountId ?? null,
    author: "system",
  });
}

/**
 * The SnapDuka Protect delivery code, to the buyer.
 *
 * Always the `delivery_code` template, never free-form: the code is stored
 * redacted, so it cannot surface in the seller's inbox, and the wording telling
 * the buyer to withhold it until the goods arrive is the approved one.
 *
 * Refuses (`seller_recipient`) when the number is the seller's own contact
 * phone. A seller holding the code can confirm their own delivery and release
 * money for goods the buyer never received — whatever the caller believes the
 * number to be, this function will not be the one that hands it over.
 */
export async function sendDeliveryCodeWhatsApp(input: {
  buyerPhone: string;
  code: string;
  reference: string;
  sellerAccountId: string;
}): Promise<WhatsAppSendResult> {
  if (!(await cloudEnabled(input.sellerAccountId))) return { delivered: false, reason: "not_configured" };

  const to = toE164(input.buyerPhone);
  if (!to) return { delivered: false, reason: "invalid_recipient" };

  const { data: seller, error } = await createAdminClient()
    .from("seller_accounts")
    .select("contact_phone")
    .eq("id", input.sellerAccountId)
    .maybeSingle();
  // Fail closed: if we cannot rule out that this is the seller's phone, the
  // code does not go. The caller falls back to SMS or retries.
  if (error) throw new Error(`Could not verify the delivery code recipient: ${error.message}`);
  if (seller?.contact_phone && toE164(seller.contact_phone) === to) {
    return { delivered: false, reason: "seller_recipient" };
  }

  return sendTemplateMessage({
    to,
    call: { name: "delivery_code", params: { code: input.code, reference: input.reference } },
    sellerAccountId: input.sellerAccountId,
    author: "system",
  });
}

/**
 * The template an outbox notification falls back to outside the 24h window,
 * or null when none covers it. Order updates only: creator messages go by
 * email/SMS and seller messages never by this channel.
 */
export function whatsAppTemplateForNotification(
  template: string,
  payload: Record<string, unknown>,
  trackingUrl: string,
): WaTemplateCall | null {
  if (template !== "order_update" || !payload.reference || !payload.status) return null;
  return templateForOrderEvent({
    status: String(payload.status),
    reference: String(payload.reference),
    trackingUrl,
  });
}
