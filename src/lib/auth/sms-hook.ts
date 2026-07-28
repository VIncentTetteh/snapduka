import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verification + parsing for Supabase's "Send SMS" Auth Hook, which uses the
 * Standard Webhooks signing scheme. Lets us deliver auth OTPs through our own
 * SMS provider (Techieszon) instead of Twilio — Supabase calls this endpoint
 * with the generated OTP and we send it.
 */

const TOLERANCE_SECONDS = 5 * 60; // replay-protection window

function signingKey(secret: string): Buffer {
  // Supabase presents the secret as "v1,whsec_<base64>"; the Standard Webhooks
  // signing key is the base64-decoded portion after the "whsec_" marker.
  const base64 = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  return Buffer.from(base64, "base64");
}

export function verifyStandardWebhook(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", signingKey(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // The header is a space-separated list of "v<version>,<base64sig>" entries;
  // a timing-safe match against any one passes.
  return signature.split(" ").some((part) => {
    const comma = part.indexOf(",");
    const b64 = comma === -1 ? part : part.slice(comma + 1);
    if (!b64) return false;
    let received: Buffer;
    try {
      received = Buffer.from(b64, "base64");
    } catch {
      return false;
    }
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}

export function buildOtpMessage(otp: string): string {
  return `${otp} is your SnapDuka verification code. It expires in 10 minutes. Do not share it with anyone.`;
}

type SmsHookPayload = { user?: { phone?: string }; sms?: { otp?: string } };

export function parseSmsHookPayload(json: unknown): { phone: string; otp: string } | null {
  const payload = json as SmsHookPayload;
  const phone = payload?.user?.phone;
  const otp = payload?.sms?.otp;
  if (typeof phone === "string" && phone && typeof otp === "string" && otp) {
    return { phone, otp };
  }
  return null;
}
