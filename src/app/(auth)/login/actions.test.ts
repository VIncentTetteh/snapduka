import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitResult } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  checkRateLimit: vi.fn<(key: string) => Promise<RateLimitResult>>(() => Promise.resolve({ ok: true })),
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

import { resendOtpAction, sendOtpAction, signInWithSocial, signOut, verifyOtpAction } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://snapduka.example";
  process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "true";
  mocks.checkRateLimit.mockResolvedValue({ ok: true as const });
});

describe("sendOtpAction", () => {
  it("sends an email OTP when the identifier is an email", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(formData({ identifier: "Seller@Example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({ email: "seller@example.com" });
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("step=code"),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("identifier=seller%40example.com"),
    );
  });

  it("sends an SMS OTP when the phone tab is used", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(
        formData({ identifier: "+233241234567", mode: "phone", region: "GH", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+233241234567",
      options: { channel: "sms" },
    });
  });

  it("normalizes a locally-typed phone number to E.164 before sending", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(
        formData({ identifier: "024 123 4567", mode: "phone", region: "GH", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+233241234567",
      options: { channel: "sms" },
    });
  });

  it("re-validates server-side, so a bad value never reaches Supabase even if the client allowed it", async () => {
    await expect(
      sendOtpAction(formData({ identifier: "not valid", mode: "email", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("Enter+a+valid+email+address"),
    );
  });

  it("rejects a phone number submitted under the email tab", async () => {
    await expect(
      sendOtpAction(formData({ identifier: "+233241234567", mode: "email", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects a wrong-length number for the submitted region", async () => {
    await expect(
      sendOtpAction(
        formData({ identifier: "2412345", mode: "phone", region: "GH", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("9+digits"));
  });

  it("falls back to safe defaults when mode and region are tampered with", async () => {
    // A hand-crafted POST can send anything; unknown values must not widen
    // validation. Unknown mode -> email, so a phone value is rejected.
    await expect(
      sendOtpAction(
        formData({ identifier: "+233241234567", mode: "sms", region: "US", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("accepts any E.164 number when the region is Other", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(
        formData({ identifier: "+254712345678", mode: "phone", region: "OTHER", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+254712345678",
      options: { channel: "sms" },
    });
  });

  it("blocks sending when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 30_000 } satisfies RateLimitResult);

    await expect(
      sendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Too+many+attempts"));
  });

  it("blocks sending when the per-identifier rate limit is exceeded, even though the per-IP limit passes", async () => {
    // Per-IP check (auth:send-otp:<ip>) passes; per-identifier check
    // (auth:send-otp:target:<identifier>) is exhausted — simulates many
    // different IPs all targeting the same phone/email (SMS-pumping).
    mocks.checkRateLimit.mockImplementation(async (key: string): Promise<RateLimitResult> => {
      if (key.startsWith("auth:send-otp:target:")) {
        return { ok: false, retryAfterMs: 45_000 };
      }
      return { ok: true };
    });

    await expect(
      sendOtpAction(
        formData({ identifier: "+233241234567", mode: "phone", region: "GH", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      "auth:send-otp:target:+233241234567",
      expect.objectContaining({ limit: 3, windowMs: 60 * 60 * 1000 }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Too+many+attempts"));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("verifyOtpAction", () => {
  it("verifies an email code and redirects to next on success", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123456", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "seller@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("verifies a phone code with type sms", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "+233241234567", code: "654321", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(verifyOtp).toHaveBeenCalledWith({
      phone: "+233241234567",
      token: "654321",
      type: "sms",
    });
  });

  it("redirects back to the code step with an error on an invalid code", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: new Error("invalid") });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "000000", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("That+code+is+invalid+or+has+expired"),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("step=code"));
  });

  it("rejects a code that is not 6 digits without calling Supabase", async () => {
    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks verification when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 } satisfies RateLimitResult);

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123456", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rate-limits verification attempts per target identifier, independent of IP", async () => {
    mocks.checkRateLimit.mockImplementation(async (key: string): Promise<RateLimitResult> => {
      if (key.startsWith("auth:verify-otp:target:")) return { ok: false, retryAfterMs: 45_000 };
      return { ok: true };
    });

    await expect(
      verifyOtpAction(formData({ identifier: "user@example.com", code: "123456", next: "/dashboard" })),
    ).rejects.toThrow();

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      "auth:verify-otp:target:user@example.com",
      expect.objectContaining({ limit: expect.any(Number), windowMs: expect.any(Number) }),
    );
  });
});

describe("resendOtpAction", () => {
  it("resends a code and redirects back to the code step with a confirmation message", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      resendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({ email: "seller@example.com" });
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("step=code"));
  });

  it("blocks resend when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 90_000 } satisfies RateLimitResult);

    await expect(
      resendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks resend when the per-identifier rate limit is exceeded, even though the per-IP limit passes", async () => {
    mocks.checkRateLimit.mockImplementation(async (key: string): Promise<RateLimitResult> => {
      if (key.startsWith("auth:send-otp:target:")) {
        return { ok: false, retryAfterMs: 20_000 };
      }
      return { ok: true };
    });

    await expect(
      resendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      "auth:send-otp:target:seller@example.com",
      expect.objectContaining({ limit: 3, windowMs: 60 * 60 * 1000 }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Too+many+attempts"));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("signInWithSocial", () => {
  it("starts an enabled social sign-in with a safe callback URL", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://accounts.google.com/oauth" },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOAuth } });

    await expect(
      signInWithSocial(formData({ provider: "google", next: "//evil.example" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://snapduka.example/auth/confirm?next=%2F" },
    });
    expect(mocks.redirect).toHaveBeenCalledWith("https://accounts.google.com/oauth");
  });

  it("rejects social providers that are not enabled", async () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "false";

    await expect(
      signInWithSocial(formData({ provider: "google", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("signs out and returns to login", async () => {
    const signOutFromSupabase = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signOut: signOutFromSupabase } });

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(signOutFromSupabase).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
