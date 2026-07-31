"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import {
  DEFAULT_PHONE_REGION,
  classifyIdentifier,
  isIdentifierMode,
  isPhoneRegion,
  validateIdentifier,
  type IdentifierMode,
  type PhoneRegion,
} from "@/lib/auth/identifier";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";
import { checkRateLimit, releaseRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const socialProviderSchema = z.enum(["google", "facebook", "apple"]);
const codeSchema = z.string().regex(/^[0-9]{6}$/, "Enter the 6-digit code.");

// ---------------------------------------------------------------------------
// Rate-limit configs
// ---------------------------------------------------------------------------

const SEND_OTP_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };    //  5 / 15 min
const VERIFY_OTP_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };  //  8 / 15 min
const RESEND_OTP_LIMIT = { limit: 3, windowMs: 15 * 60 * 1000 };  //  3 / 15 min
const SOCIAL_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };     // 10 / 15 min

// Per-target-identifier limit, independent of requester IP. Caps how many
// codes any single email/phone can receive regardless of how many different
// IPs request them — the primary defense against SMS-pumping / toll fraud,
// since Supabase auto-creates accounts and sends a real (billed) SMS on
// every signInWithOtp({ phone }) call with no ownership verification.
const IDENTIFIER_SEND_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 }; // 3 / 60 min, per target identifier

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function authNextPath(value: string): string {
  return safeNextPath(value || "/onboarding");
}

async function confirmationUrl(next: string): Promise<string> {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APP_URL");
  }
  const appUrl = new URL(configuredUrl);
  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use http or https.");
  }
  // In development the live request origin wins so the OAuth redirect
  // points at the port the app is actually running on.
  const origin = await appOrigin();
  const confirmUrl = new URL("/auth/confirm", origin);
  confirmUrl.searchParams.set("next", next);
  return confirmUrl.toString();
}

function loginRedirect(kind: "error" | "message", text: string, next: string): never {
  const searchParams = new URLSearchParams({ [kind]: text, next });
  redirect(`/login?${searchParams.toString()}`);
}

function toCodeStep(identifier: string, next: string, kind: "error" | "message", text: string): never {
  const searchParams = new URLSearchParams({ step: "code", identifier, next, [kind]: text });
  redirect(`/login?${searchParams.toString()}`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function sendOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = await checkRateLimit(`auth:send-otp:${ip}`, SEND_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    loginRedirect("error", `Too many attempts. Try again in ${waitSec} seconds.`, next);
  }

  // Re-run the form's own validation here rather than trusting it. The client
  // sends mode/region as plain fields, so both are treated as untrusted input
  // and fall back to safe defaults when absent or tampered with.
  const rawMode = formValue(formData, "mode");
  const mode: IdentifierMode = isIdentifierMode(rawMode) ? rawMode : "email";
  const rawRegion = formValue(formData, "region");
  const region: PhoneRegion = isPhoneRegion(rawRegion) ? rawRegion : DEFAULT_PHONE_REGION;

  const validated = validateIdentifier(mode, formValue(formData, "identifier"), region);
  if (!validated.ok) {
    loginRedirect("error", validated.message, next);
  }
  const identifier = { kind: validated.kind, value: validated.value };

  const identifierRl = await checkRateLimit(`auth:send-otp:target:${identifier.value}`, IDENTIFIER_SEND_LIMIT);
  if (!identifierRl.ok) {
    const waitSec = Math.ceil(identifierRl.retryAfterMs / 1000);
    loginRedirect("error", `Too many attempts. Try again in ${waitSec} seconds.`, next);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.signInWithOtp({ email: identifier.value })
      : await supabase.auth.signInWithOtp({ phone: identifier.value, options: { channel: "sms" } });

  if (error) {
    // No code was sent, so this attempt must not count against the identifier.
    // A provider outage previously spent the caller's whole allowance and then
    // told them "Too many attempts" — locking them out of their own account
    // over a failure that was entirely ours. The IP limit is deliberately NOT
    // refunded: it is what still bounds repeated calls from one source when the
    // provider is failing for everyone.
    await releaseRateLimit(`auth:send-otp:target:${identifier.value}`);
    loginRedirect("error", "We could not send a code. Please try again.", next);
  }

  toCodeStep(
    identifier.value,
    next,
    "message",
    identifier.kind === "email" ? "We sent a 6-digit code to your email." : "We sent a 6-digit code by SMS.",
  );
}

export async function verifyOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const rawIdentifier = formValue(formData, "identifier");
  const ip = await clientIp();

  const rl = await checkRateLimit(`auth:verify-otp:${ip}`, VERIFY_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    toCodeStep(rawIdentifier, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const identifier = classifyIdentifier(rawIdentifier);
  const parsedCode = codeSchema.safeParse(formValue(formData, "code").trim());

  if (identifier.kind === "invalid" || !parsedCode.success) {
    toCodeStep(rawIdentifier, next, "error", "Enter the 6-digit code.");
  }

  // Per-identifier limit, independent of requester IP — closes the gap where
  // an attacker could brute-force a known phone/email's OTP code by
  // distributing verify attempts across many IPs/serverless instances.
  const identifierRl = await checkRateLimit(`auth:verify-otp:target:${identifier.value}`, VERIFY_OTP_LIMIT);
  if (!identifierRl.ok) {
    const waitSec = Math.ceil(identifierRl.retryAfterMs / 1000);
    toCodeStep(identifier.value, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.verifyOtp({ email: identifier.value, token: parsedCode.data, type: "email" })
      : await supabase.auth.verifyOtp({ phone: identifier.value, token: parsedCode.data, type: "sms" });

  if (error) {
    toCodeStep(identifier.value, next, "error", "That code is invalid or has expired.");
  }

  redirect(next);
}

export async function resendOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const rawIdentifier = formValue(formData, "identifier");
  const ip = await clientIp();

  const rl = await checkRateLimit(`auth:resend-otp:${ip}`, RESEND_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    toCodeStep(rawIdentifier, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const identifier = classifyIdentifier(rawIdentifier);
  if (identifier.kind === "invalid") {
    loginRedirect("error", "Enter a valid email address or phone number.", next);
  }

  const identifierRl = await checkRateLimit(`auth:send-otp:target:${identifier.value}`, IDENTIFIER_SEND_LIMIT);
  if (!identifierRl.ok) {
    const waitSec = Math.ceil(identifierRl.retryAfterMs / 1000);
    toCodeStep(identifier.value, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.signInWithOtp({ email: identifier.value })
      : await supabase.auth.signInWithOtp({ phone: identifier.value, options: { channel: "sms" } });

  if (error) {
    await releaseRateLimit(`auth:send-otp:target:${identifier.value}`);
    toCodeStep(identifier.value, next, "error", "We could not resend the code. Please try again.");
  }

  toCodeStep(
    identifier.value,
    next,
    "message",
    identifier.kind === "email" ? "We sent a new code to your email." : "We sent a new code by SMS.",
  );
}

export async function signInWithSocial(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = await checkRateLimit(`auth:social:${ip}`, SOCIAL_LIMIT);
  if (!rl.ok) {
    loginRedirect("error", "Too many requests. Please wait before trying again.", next);
  }

  const parsedProvider = socialProviderSchema.safeParse(formValue(formData, "provider"));
  if (!parsedProvider.success || !isSocialProviderEnabled(parsedProvider.data)) {
    loginRedirect("error", "That social sign-in option is not available.", next);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsedProvider.data,
    options: { redirectTo: await confirmationUrl(next) },
  });

  if (error || !data.url) {
    loginRedirect("error", "We could not start social sign-in. Please try again.", next);
  }

  redirect(data.url);
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    loginRedirect("error", "We could not sign you out. Please try again.", "/");
  }

  redirect("/login");
}
