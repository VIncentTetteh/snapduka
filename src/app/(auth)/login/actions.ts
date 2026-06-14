"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const socialProviderSchema = z.enum(["google", "facebook", "apple"]);

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function loginRedirect(
  kind: "error" | "message",
  text: string,
  next: string,
): never {
  const searchParams = new URLSearchParams({
    [kind]: text,
    next,
  });

  redirect(`/login?${searchParams.toString()}`);
}

function confirmationUrl(next: string): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!configuredUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APP_URL");
  }

  const appUrl = new URL(configuredUrl);

  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use http or https.");
  }

  const confirmUrl = new URL("/auth/confirm", appUrl.origin);
  confirmUrl.searchParams.set("next", next);

  return confirmUrl.toString();
}

export async function signIn(formData: FormData): Promise<never> {
  const next = safeNextPath(formValue(formData, "next"));
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
  const next = safeNextPath(formValue(formData, "next"));
  const credentials = signUpSchema.safeParse({
    email: formValue(formData, "email").trim().toLowerCase(),
    password: formValue(formData, "password"),
  });

  if (!credentials.success) {
    loginRedirect(
      "error",
      "Use a valid email and a password of at least 8 characters.",
      next,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials.data,
    options: {
      emailRedirectTo: confirmationUrl(next),
    },
  });

  if (error) {
    loginRedirect("error", "We could not create that account.", next);
  }

  if (data.session) {
    redirect(next);
  }

  loginRedirect("message", "Check your email to confirm your account.", next);
}

export async function signInWithSocial(formData: FormData): Promise<never> {
  const next = safeNextPath(formValue(formData, "next"));
  const parsedProvider = socialProviderSchema.safeParse(
    formValue(formData, "provider"),
  );

  if (
    !parsedProvider.success ||
    !isSocialProviderEnabled(parsedProvider.data)
  ) {
    loginRedirect(
      "error",
      "That social sign-in option is not available.",
      next,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsedProvider.data,
    options: {
      redirectTo: confirmationUrl(next),
    },
  });

  if (error || !data.url) {
    loginRedirect(
      "error",
      "We could not start social sign-in. Please try again.",
      next,
    );
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
