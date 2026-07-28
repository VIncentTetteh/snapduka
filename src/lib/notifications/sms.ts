/**
 * Whether the Techieszon credentials are present, without making a request.
 *
 * Lets callers that must answer before sending — the Supabase Send SMS hook,
 * which has a hard 5s budget — reject an unconfigured provider up front
 * instead of discovering it after the response has already gone out.
 */
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TECHIESZON_SMS_API_KEY &&
      process.env.TECHIESZON_SMS_API_URL &&
      process.env.TECHIESZON_SMS_SENDER_ID,
  );
}

export async function sendSms(recipient: string, text: string) {
  const apiKey = process.env.TECHIESZON_SMS_API_KEY;
  const apiUrl = process.env.TECHIESZON_SMS_API_URL;
  const senderId = process.env.TECHIESZON_SMS_SENDER_ID;
  // Inline rather than via isSmsConfigured() so TypeScript narrows all three.
  if (!apiKey || !apiUrl || !senderId) return { delivered: false, reason: "not_configured" };
  const url = new URL(`${apiUrl}?action=send-sms`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("to", recipient.replace(/\D/g, ""));
  url.searchParams.set("from", senderId);
  url.searchParams.set("sms", text);
  // Techieszon authenticates via a query param (no header-based option in
  // their API), so the request URL embeds the API key and the recipient's
  // phone number. A raw fetch failure can echo that URL back in its own
  // message — catch it here and re-throw a fixed string so the key/phone
  // never reach the notifications.last_error column or any log.
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("SMS provider request failed.");
  }
  if (!response.ok) throw new Error("SMS provider rejected the notification.");
  return { delivered: true };
}
