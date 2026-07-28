import { after, NextResponse } from "next/server";

import { buildOtpMessage, parseSmsHookPayload, verifyStandardWebhook } from "@/lib/auth/sms-hook";
import { isSmsConfigured, sendSms } from "@/lib/notifications/sms";

// Supabase "Send SMS" Auth Hook endpoint. Supabase calls this (server-to-server,
// Standard Webhooks signed) with the generated phone OTP; we deliver it through
// Techieszon via the shared sendSms(). Configure in the Supabase dashboard:
//   Authentication → Hooks → Send SMS hook → HTTPS → {APP_URL}/api/auth/sms-hook
// and set SUPABASE_SEND_SMS_HOOK_SECRET to the secret it generates.
//
// Supabase abandons the hook after a hard 5s and fails the whole sign-in with
// `hook_timeout`. A cold Vercel function plus a ~1.7s Techieszon round trip
// overruns that, so everything that can answer without a network call runs
// before the response and the provider call is dispatched via after(). The
// trade-off is deliberate: a provider failure can no longer be reported back
// to Supabase, so it is logged instead and the buyer recovers with "resend".
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: { message: "Hook not configured." } }, { status: 500 });
  }

  const raw = await request.text();
  const verified = verifyStandardWebhook(
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    raw,
    secret,
  );
  if (!verified) {
    return NextResponse.json({ error: { message: "Invalid signature." } }, { status: 401 });
  }

  let payload: ReturnType<typeof parseSmsHookPayload>;
  try {
    payload = parseSmsHookPayload(JSON.parse(raw));
  } catch {
    payload = null;
  }
  if (!payload) {
    return NextResponse.json({ error: { message: "Invalid payload." } }, { status: 400 });
  }

  // Checked before responding: a missing API key is the likeliest
  // misconfiguration and costs nothing to detect, so it stays a real error
  // Supabase can surface to the user.
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: { message: "SMS provider not configured." } }, { status: 500 });
  }

  const { phone, otp } = payload;
  after(async () => {
    try {
      const result = await sendSms(phone, buildOtpMessage(otp));
      if (!result.delivered) {
        console.error("[sms-hook] provider refused the OTP", result.reason);
      }
    } catch (error) {
      // sendSms() already scrubs the API key and phone number from its errors.
      console.error("[sms-hook] provider request failed", error);
    }
  });

  // Empty 200 body signals success to the Supabase Auth Hook.
  return NextResponse.json({});
}
