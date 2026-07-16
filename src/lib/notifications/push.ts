export async function sendPush(recipient: string, title: string, text: string, url?: string) {
  if (!process.env.PUSH_WEBHOOK_URL) return { delivered: false, reason: "not_configured" };
  const response = await fetch(process.env.PUSH_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: recipient, title, text, url }),
  });
  if (!response.ok) throw new Error("Push provider rejected the notification.");
  return { delivered: true };
}
