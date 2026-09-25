"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isPhoneRegion, validatePhoneIdentifier, type PhoneRegion } from "@/lib/auth/identifier";
import { safeNextPath } from "@/lib/auth/redirect";
import { isBuyerAccountsEnabled } from "@/lib/buyer/session";
import { checkRateLimit, releaseRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Buyer sign-in by phone OTP.
 *
 * The code itself is delivered by the existing Supabase Send-SMS hook
 * (src/app/api/auth/sms-hook -> Techieszon); nothing here sends an SMS. The
 * per-number limit deliberately shares its key with seller login
 * (`auth:send-otp:target:<phone>`): SMS pumping is billed per message whichever
 * page asked, so both pages must draw on one allowance per number.
 *
 * Two modes:
 *   signin — nobody is signed in: signInWithOtp creates or signs in the phone user.
 *   link   — someone is signed in WITHOUT a phone (a seller who uses email):
 *            updateUser({ phone }) attaches the number to that same account,
 *            verified with a `phone_change` code. One person, one login, and
 *            their seller session is not thrown away to buy something.
 */

const SEND_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };
const VERIFY_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };
const TARGET_SEND_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };
const codeSchema = z.string().regex(/^[0-9]{6}$/);
const PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

type Mode = "signin" | "link";

async function clientIp(): Promise<string> {
  try {
    return (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nextPath(formData: FormData): string {
  return safeNextPath(field(formData, "next"), "/me");
}

function back(params: Record<string, string>): never {
  redirect(`/me?${new URLSearchParams(params).toString()}`);
}

function codeStep(phone: string, mode: Mode, next: string, kind: "error" | "message", text: string): never {
  back({ step: "code", phone, mode, next, [kind]: text });
}

async function ensureEnabled(): Promise<void> {
  if (!(await isBuyerAccountsEnabled())) redirect("/");
}

export async function sendBuyerOtpAction(formData: FormData): Promise<never> {
  await ensureEnabled();
  const next = nextPath(formData);

  const ipLimit = await checkRateLimit(`buyer:send-otp:${await clientIp()}`, SEND_LIMIT);
  if (!ipLimit.ok) {
    back({ next, error: `Too many attempts. Try again in ${Math.ceil(ipLimit.retryAfterMs / 1000)} seconds.` });
  }

  const rawRegion = field(formData, "region");
  const region: PhoneRegion = isPhoneRegion(rawRegion) && rawRegion !== "OTHER" ? rawRegion : "GH";
  const validated = validatePhoneIdentifier(field(formData, "phone"), region);
  if (!validated.ok) back({ next, error: validated.message });
  const phone = validated.value;

  const targetKey = `auth:send-otp:target:${phone}`;
  const targetLimit = await checkRateLimit(targetKey, TARGET_SEND_LIMIT);
  if (!targetLimit.ok) {
    back({ next, error: `Too many codes for this number. Try again in ${Math.ceil(targetLimit.retryAfterMs / 60000)} minutes.` });
  }

  const supabase = await createClient();
  const { data: current } = await supabase.auth.getUser();
  const mode: Mode = current.user && !current.user.phone ? "link" : "signin";

  const { error } =
    mode === "link"
      ? await supabase.auth.updateUser({ phone })
      : await supabase.auth.signInWithOtp({ phone, options: { channel: "sms" } });

  if (error) {
    // No code went out, so it must not count against the number (same rule as
    // seller login). The IP limit is kept: it bounds a failing provider loop.
    await releaseRateLimit(targetKey);
    back({
      next,
      error:
        mode === "link" && /already|registered|exists/i.test(error.message)
          ? "This number already has its own SnapDuka sign-in. Sign out, then sign in with your phone number."
          : "We could not send a code. Please try again.",
    });
  }

  codeStep(phone, mode, next, "message", "We sent a 6-digit code by SMS.");
}

export async function verifyBuyerOtpAction(formData: FormData): Promise<never> {
  await ensureEnabled();
  const next = nextPath(formData);
  const phone = field(formData, "phone").trim();
  const mode: Mode = field(formData, "mode") === "link" ? "link" : "signin";

  if (!PHONE_E164.test(phone)) back({ next, error: "Enter your phone number again." });

  const ipLimit = await checkRateLimit(`buyer:verify-otp:${await clientIp()}`, VERIFY_LIMIT);
  const targetLimit = await checkRateLimit(`auth:verify-otp:target:${phone}`, VERIFY_LIMIT);
  if (!ipLimit.ok || !targetLimit.ok) {
    codeStep(phone, mode, next, "error", "Too many attempts. Wait a few minutes and try again.");
  }

  const code = codeSchema.safeParse(field(formData, "code").trim());
  if (!code.success) codeStep(phone, mode, next, "error", "Enter the 6-digit code.");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token: code.data,
    type: mode === "link" ? "phone_change" : "sms",
  });
  if (error) codeStep(phone, mode, next, "error", "That code is invalid or has expired.");

  // The profile itself is created by getBuyerSession on the next page load, so
  // every way of arriving signed in converges on the one idempotent bootstrap.
  redirect(next);
}

export async function signOutBuyerAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/me");
}
