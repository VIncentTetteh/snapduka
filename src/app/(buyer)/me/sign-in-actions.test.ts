import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  enabled: vi.fn(),
  checkRateLimit: vi.fn(),
  releaseRateLimit: vi.fn(),
  getUser: vi.fn(),
  signInWithOtp: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "1.2.3.4" })) }));
vi.mock("@/lib/buyer/session", () => ({ isBuyerAccountsEnabled: mocks.enabled }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, releaseRateLimit: mocks.releaseRateLimit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: mocks.getUser,
      signInWithOtp: mocks.signInWithOtp,
      updateUser: mocks.updateUser,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));
import { sendBuyerOtpAction, verifyBuyerOtpAction } from "./sign-in-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([k, v]) => data.set(k, v));
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: Error) => e,
  );
  return decodeURIComponent(String(error?.message).replace("NEXT_REDIRECT:", "")).replace(/\+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe("sendBuyerOtpAction", () => {
  it("is unreachable while the flag is off", async () => {
    mocks.enabled.mockResolvedValue(false);

    expect(await redirectOf(sendBuyerOtpAction(form({ phone: "0241234567" })))).toBe("/");
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends a sign-in code by SMS for a guest (delivered by the existing SMS hook)", async () => {
    const url = await redirectOf(sendBuyerOtpAction(form({ phone: "024 123 4567", region: "GH" })));

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ phone: "+233241234567", options: { channel: "sms" } });
    expect(url).toContain("step=code");
    expect(url).toContain("mode=signin");
  });

  it("shares the per-number SMS allowance with seller login", async () => {
    await redirectOf(sendBuyerOtpAction(form({ phone: "0241234567" })));

    expect(mocks.checkRateLimit).toHaveBeenCalledWith("auth:send-otp:target:+233241234567", expect.anything());
  });

  it("attaches the phone to an existing email login instead of replacing the session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "seller@x.com", phone: "" } } });

    const url = await redirectOf(sendBuyerOtpAction(form({ phone: "0241234567" })));

    expect(mocks.updateUser).toHaveBeenCalledWith({ phone: "+233241234567" });
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    expect(url).toContain("mode=link");
  });

  it("refunds the per-number allowance when no code was sent", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: { message: "provider down" } });

    const url = await redirectOf(sendBuyerOtpAction(form({ phone: "0241234567" })));

    expect(mocks.releaseRateLimit).toHaveBeenCalledWith("auth:send-otp:target:+233241234567");
    expect(url).toContain("error=");
  });

  it("rejects an invalid number before calling Supabase", async () => {
    const url = await redirectOf(sendBuyerOtpAction(form({ phone: "12" })));

    expect(url).toContain("error=");
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("keeps the post-sign-in destination local", async () => {
    const url = await redirectOf(sendBuyerOtpAction(form({ phone: "0241234567", next: "https://evil.example" })));

    expect(url).toContain("next=/me");
  });
});

describe("verifyBuyerOtpAction", () => {
  it("verifies an sms code and continues to next", async () => {
    const url = await redirectOf(
      verifyBuyerOtpAction(form({ phone: "+233241234567", code: "123456", mode: "signin", next: "/shop/checkout" })),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ phone: "+233241234567", token: "123456", type: "sms" });
    expect(url).toBe("/shop/checkout");
  });

  it("verifies a phone_change code in link mode", async () => {
    await redirectOf(verifyBuyerOtpAction(form({ phone: "+233241234567", code: "123456", mode: "link" })));

    expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ type: "phone_change" }));
  });

  it("returns to the code step on a wrong code", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "invalid" } });

    const url = await redirectOf(verifyBuyerOtpAction(form({ phone: "+233241234567", code: "000000" })));

    expect(url).toContain("step=code");
    expect(url).toContain("invalid or has expired");
  });

  it("applies the per-number verify limit shared with seller login", async () => {
    mocks.checkRateLimit.mockImplementation((key: string) =>
      Promise.resolve(key.startsWith("auth:verify-otp:target:") ? { ok: false, retryAfterMs: 1000 } : { ok: true }),
    );

    const url = await redirectOf(verifyBuyerOtpAction(form({ phone: "+233241234567", code: "123456" })));

    expect(url).toContain("Too many attempts");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
