const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo tokens are self-identifying, which is how we route without a schema change. */
function isExpoToken(recipient: string): boolean {
  return recipient.startsWith("ExponentPushToken[") || recipient.startsWith("ExpoPushToken[");
}

export type PushResult = { delivered: boolean; reason?: string };

/**
 * Deliver to Expo's push service, which fans out to APNs and FCM.
 *
 * Expo answers 200 even when an individual message failed, with the outcome in
 * `data.status`. Treating the HTTP status as success is the classic way to end
 * up with a queue that reports everything sent and a seller who never hears a
 * thing, so the ticket is inspected.
 */
export async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<PushResult> {
  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify([{ to: token, title, body, sound: "default", data }]),
  });

  if (!response.ok) {
    throw new Error(`Expo push service returned ${response.status}.`);
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: { status?: string; message?: string; details?: { error?: string } }[];
  } | null;
  const ticket = payload?.data?.[0];

  if (!ticket) throw new Error("Expo push service returned no ticket.");
  if (ticket.status === "ok") return { delivered: true };

  // The app was uninstalled or the token was rotated. Retrying can never
  // succeed, so surface it as `not_configured`, which the worker routes
  // straight to dead_letter instead of spending five backed-off attempts.
  if (ticket.details?.error === "DeviceNotRegistered") {
    await deactivateToken(token);
    return { delivered: false, reason: "not_configured" };
  }

  throw new Error(ticket.message ?? "Expo push service rejected the notification.");
}

/**
 * Stop targeting a device Expo has told us is gone. Best-effort: the delivery
 * outcome is already decided, and a failure here only means we try the same
 * dead token again next time.
 */
async function deactivateToken(token: string): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient()
      .from("device_push_tokens")
      .update({ active: false })
      .eq("expo_push_token", token);
  } catch (error) {
    console.error("[push] could not deactivate a dead token", error);
  }
}

/**
 * Send a push to whatever kind of recipient this is.
 *
 * Two transports coexist: Expo tokens from the seller app, and W3C Web Push
 * endpoints from the browser (`push_subscriptions`), which are relayed to
 * PUSH_WEBHOOK_URL because this app does not implement VAPID itself.
 */
export async function sendPush(
  recipient: string,
  title: string,
  text: string,
  url?: string,
  data?: Record<string, unknown>,
): Promise<PushResult> {
  if (isExpoToken(recipient)) {
    return sendExpoPush(recipient, title, text, { ...data, ...(url ? { url } : {}) });
  }

  if (!process.env.PUSH_WEBHOOK_URL) return { delivered: false, reason: "not_configured" };
  const response = await fetch(process.env.PUSH_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: recipient, title, text, url }),
  });
  if (!response.ok) throw new Error("Push provider rejected the notification.");
  return { delivered: true };
}
