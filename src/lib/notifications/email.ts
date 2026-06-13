export async function sendEmail(recipient: string, subject: string, text: string) {
  if (!process.env.EMAIL_WEBHOOK_URL) return { delivered: false, reason: "not_configured" };
  const response = await fetch(process.env.EMAIL_WEBHOOK_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: recipient, subject, text }),
  });
  if (!response.ok) throw new Error("Email provider rejected the notification.");
  return { delivered: true };
}
