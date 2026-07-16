import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitResult } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  // Rate limiter always allows in tests — we test it separately in rate-limit.test.ts
  checkRateLimit: vi.fn((): RateLimitResult => ({ ok: true })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { signIn, signInWithSocial, signOut, signUp } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

// Passwords used in sign-up tests must meet the strengthened schema:
// min 8 chars, at least one uppercase, one lowercase, one digit.
const STRONG_PASSWORD = "Correct-H0rse-Battery";

describe("login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://snapduka.example";
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "true";
    mocks.checkRateLimit.mockReturnValue({ ok: true as const });
  });

  it("signs in and rejects an unsafe next redirect", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { signInWithPassword },
    });

    await expect(
      signIn(
        formData({
          email: "seller@example.com",
          password: "correct horse battery staple",
          next: "//evil.example",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "seller@example.com",
      password: "correct horse battery staple",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("returns an explicit sign-in error through the login page", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          error: new Error("invalid credentials"),
        }),
      },
    });

    await expect(
      signIn(
        formData({
          email: "seller@example.com",
          password: "wrong-password",
          next: "/settings",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?error=Invalid+email+or+password.&next=%2Fsettings",
    );
  });

  it("blocks sign-in when rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 30_000 } satisfies RateLimitResult);

    await expect(
      signIn(formData({ email: "seller@example.com", password: "any", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("Too+many+sign-in+attempts"),
    );
  });

  it("creates a sign-up confirmation URL on the configured app origin", async () => {
    const signUpWithPassword = vi.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { signUp: signUpWithPassword },
    });

    await expect(
      signUp(
        formData({
          email: "new@example.com",
          password: STRONG_PASSWORD,
          next: "/dashboard",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signUpWithPassword).toHaveBeenCalledWith({
      email: "new@example.com",
      password: STRONG_PASSWORD,
      options: {
        emailRedirectTo:
          "https://snapduka.example/auth/confirm?next=%2Fdashboard",
      },
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?message=Check+your+email+to+confirm+your+account.&next=%2Fdashboard",
    );
  });

  it("sends a new account to onboarding when no return path is supplied", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { session: { access_token: "session" } },
          error: null,
        }),
      },
    });

    await expect(
      signUp(
        formData({
          email: "new@example.com",
          password: STRONG_PASSWORD,
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("explains when the email already belongs to an account", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { session: null },
          error: Object.assign(new Error("User already registered"), {
            code: "user_already_exists",
          }),
        }),
      },
    });

    await expect(
      signUp(
        formData({
          email: "existing@example.com",
          password: STRONG_PASSWORD,
          next: "/onboarding",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?error=An+account+already+exists+for+this+email.+Sign+in+or+continue+with+Google.&next=%2Fonboarding",
    );
  });

  it("rejects weak passwords that fail the strength requirement", async () => {
    await expect(
      signUp(formData({ email: "new@example.com", password: "alllowercase1", next: "/" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("uppercase"),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(
      signUp(formData({ email: "new@example.com", password: "Ab1!", next: "/" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("8+characters"),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks sign-up when rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 60_000 } satisfies RateLimitResult);

    await expect(
      signUp(formData({ email: "new@example.com", password: STRONG_PASSWORD })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("Too+many+sign-up+attempts"),
    );
  });

  it("starts an enabled social sign-in with a safe callback URL", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://accounts.google.com/oauth" },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { signInWithOAuth },
    });

    await expect(
      signInWithSocial(
        formData({
          provider: "google",
          next: "//evil.example",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://snapduka.example/auth/confirm?next=%2F",
      },
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://accounts.google.com/oauth",
    );
  });

  it("rejects social providers that are not enabled", async () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "false";

    await expect(
      signInWithSocial(
        formData({
          provider: "google",
          next: "/dashboard",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?error=That+social+sign-in+option+is+not+available.&next=%2Fdashboard",
    );
  });

  it("signs out and returns to login", async () => {
    const signOutFromSupabase = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { signOut: signOutFromSupabase },
    });

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(signOutFromSupabase).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
