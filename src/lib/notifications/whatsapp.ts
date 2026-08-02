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
 */
export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_WEBHOOK_URL);
}

export async function sendWhatsApp(recipient: string, text: string) {
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
