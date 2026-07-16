export function buyerInitiatedWhatsApp(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

export async function sendWhatsApp(recipient: string, text: string) {
  if (!process.env.WHATSAPP_WEBHOOK_URL) return { delivered: false, reason: "not_configured" };
  const response = await fetch(process.env.WHATSAPP_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: recipient, text }),
  });
  if (!response.ok) throw new Error("WhatsApp provider rejected the notification.");
  return { delivered: true };
}
