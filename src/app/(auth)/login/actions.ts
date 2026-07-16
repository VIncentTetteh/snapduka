"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { safeNextPath } from "@/lib/auth/redirect";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSocialProviderEnabled } from "@/lib/auth/social";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * Passwords must be at least 8 characters and contain at least one uppercase
 * letter, one lowercase letter, and one digit. The 128-char ceiling prevents
 * bcrypt-truncation attacks.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter.")
  .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter.")
  .refine((v) => /[0-9]/.test(v), "Password must contain a number.");

const signUpSchema = z.object({
  email: z.email(),
  password: passwordSchema,
});

const socialProviderSchema = z.enum(["google", "facebook", "apple"]);

// ---------------------------------------------------------------------------
// Rate-limit configs
// ---------------------------------------------------------------------------

const SIGN_IN_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };   // 10 / 15 min
const SIGN_UP_LIMIT = { limit: 5,  windowMs: 60 * 60 * 1000 };    //  5 / 60 min
const SOCIAL_LIMIT  = { limit: 10, windowMs: 15 * 60 * 1000 };    // 10 / 15 min

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

function signUpErrorMessage(error: { code?: string }): string {
  if (error.code === "user_already_exists") {
    return "An account already exists for this email. Sign in or continue with Google.";
  }
  return "We could not create that account.";
}

function loginRedirect(
  kind: "error" | "message",
  text: string,
  next: string,
): never {
  const searchParams = new URLSearchParams({ [kind]: text, next });
  redirect(`/login?${searchParams.toString()}`);
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
  // In development the live request origin wins so confirmation and magic
  // links point at the port the app is actually running on.
  const origin = await appOrigin();
  const confirmUrl = new URL("/auth/confirm", origin);
  confirmUrl.searchParams.set("next", next);
  return confirmUrl.toString();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function signIn(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:signin:${ip}`, SIGN_IN_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    loginRedirect(
      "error",
      `Too many sign-in attempts. Try again in ${waitSec} seconds.`,
      next,
    );
  }

  const credentials = signInSchema.safeParse({
    email: formValue(formData, "email").trim().toLowerCase(),
    password: formValue(formData, "password"),
  });

  if (!credentials.success) {
    loginRedirect("error", "Enter a valid email and password.", next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);

  if (error) {
    loginRedirect("error", "Invalid email or password.", next);
  }

  redirect(next);
}

export async function signUp(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:signup:${ip}`, SIGN_UP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    loginRedirect(
      "error",
      `Too many sign-up attempts. Try again in ${waitSec} seconds.`,
      next,
    );
  }

  const credentials = signUpSchema.safeParse({
    email: formValue(formData, "email").trim().toLowerCase(),
    password: formValue(formData, "password"),
  });

  if (!credentials.success) {
    const message =
      credentials.error.issues[0]?.message ??
      "Use a valid email and a password of at least 8 characters.";
    loginRedirect("error", message, next);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials.data,
    options: { emailRedirectTo: await confirmationUrl(next) },
  });

  if (error) {
    loginRedirect("error", signUpErrorMessage(error), next);
  }

  if (data.session) {
    redirect(next);
  }

  loginRedirect("message", "Check your email to confirm your account.", next);
}

export async function signInWithMagicLink(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:magic:${ip}`, SIGN_IN_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    loginRedirect(
      "error",
      `Too many requests. Try again in ${waitSec} seconds.`,
      next,
    );
  }

  const parsedEmail = z
    .email()
    .safeParse(formValue(formData, "email").trim().toLowerCase());

  if (!parsedEmail.success) {
    loginRedirect("error", "Enter a valid email address.", next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsedEmail.data,
    options: { emailRedirectTo: await confirmationUrl(next) },
  });

  if (error) {
    loginRedirect(
      "error",
      "We could not send the magic link. Please try again.",
      next,
    );
  }

  loginRedirect(
    "message",
    "Check your email for a magic link to sign in.",
    next,
  );
}

export async function signInWithSocial(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:social:${ip}`, SOCIAL_LIMIT);
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
