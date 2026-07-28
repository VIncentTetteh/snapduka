import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, verify, close, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const close = vi.fn();
  return { sendMail, verify, close, createTransport: vi.fn(() => ({ sendMail, verify, close })) };
});

vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { sendEmail, verifyEmailTransport } from "@/lib/notifications/email";

/** Distinct credentials per test so the pooled-transporter cache never hits. */
let credentialSeed = 0;
function stubGmailEnv(overrides: Record<string, string> = {}) {
  credentialSeed += 1;
  const env: Record<string, string> = {
    EMAIL_SMTP_HOST: "",
    EMAIL_SMTP_PORT: "",
    EMAIL_SMTP_USER: `seller${credentialSeed}@gmail.com`,
    EMAIL_SMTP_PASSWORD: `app-password-${credentialSeed}`,
    EMAIL_FROM_EMAIL: "",
    EMAIL_FROM_NAME: "",
    EMAIL_WEBHOOK_URL: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return env;
}

describe("sendEmail", () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: "<abc@gmail.com>" });
    verify.mockReset().mockResolvedValue(true);
    createTransport.mockClear();
    close.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports not_configured when neither SMTP nor the webhook is set", async () => {
    stubGmailEnv({ EMAIL_SMTP_USER: "", EMAIL_SMTP_PASSWORD: "" });

    const result = await sendEmail("buyer@example.com", "Hi", "Body");

    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("defaults to Gmail's implicit-TLS submission endpoint", async () => {
    const env = stubGmailEnv();

    const result = await sendEmail("buyer@example.com", "Your order shipped", "Track it here.");

    expect(result).toEqual({ delivered: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: env.EMAIL_SMTP_USER, pass: env.EMAIL_SMTP_PASSWORD },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: env.EMAIL_SMTP_USER,
      to: "buyer@example.com",
      subject: "Your order shipped",
      text: "Track it here.",
    });
  });

  it("uses STARTTLS when port 587 is configured", async () => {
    stubGmailEnv({ EMAIL_SMTP_PORT: "587" });

    await sendEmail("buyer@example.com", "Hi", "Body");

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  it("builds a display-name From header and strips header-injection characters", async () => {
    const env = stubGmailEnv({
      EMAIL_FROM_EMAIL: "orders@snapduka.com",
      EMAIL_FROM_NAME: 'Snap"Duka\r\nBcc: attacker@example.com',
    });

    await sendEmail("buyer@example.com", "Hi", "Body");

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"SnapDukaBcc: attacker@example.com" <orders@snapduka.com>' }),
    );
    expect(env.EMAIL_SMTP_USER).not.toBe("orders@snapduka.com");
  });

  it("reuses one pooled transporter across sends with identical credentials", async () => {
    stubGmailEnv();

    await sendEmail("one@example.com", "Hi", "Body");
    await sendEmail("two@example.com", "Hi", "Body");

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("surfaces only the SMTP error code, never the credentials or dialogue", async () => {
    const env = stubGmailEnv();
    sendMail.mockRejectedValue(
      Object.assign(
        new Error(`Invalid login: 535-5.7.8 Username and Password not accepted ${env.EMAIL_SMTP_PASSWORD}`),
        { code: "EAUTH" },
      ),
    );

    await expect(sendEmail("buyer@example.com", "Hi", "Body")).rejects.toThrow(
      "Email provider rejected the notification. (EAUTH)",
    );
    try {
      await sendEmail("buyer@example.com", "Hi", "Body");
    } catch (error) {
      expect((error as Error).message).not.toContain(env.EMAIL_SMTP_PASSWORD);
      expect((error as Error).message).not.toContain("buyer@example.com");
    }
  });

  it("drops a non-conforming error code rather than echoing it", async () => {
    stubGmailEnv();
    sendMail.mockRejectedValue(Object.assign(new Error("boom"), { code: "leaked secret value" }));

    await expect(sendEmail("buyer@example.com", "Hi", "Body")).rejects.toThrow(
      "Email provider rejected the notification.",
    );
    await expect(sendEmail("buyer@example.com", "Hi", "Body")).rejects.not.toThrow(/leaked/);
  });

  it("falls back to the webhook transport when SMTP credentials are absent", async () => {
    stubGmailEnv({
      EMAIL_SMTP_USER: "",
      EMAIL_SMTP_PASSWORD: "",
      EMAIL_WEBHOOK_URL: "https://hooks.example.com/email",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail("buyer@example.com", "Hi", "Body");

    expect(result).toEqual({ delivered: true });
    expect(createTransport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://hooks.example.com/email", expect.objectContaining({ method: "POST" }));
  });

  it("prefers SMTP over the webhook when both are configured", async () => {
    stubGmailEnv({ EMAIL_WEBHOOK_URL: "https://hooks.example.com/email" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail("buyer@example.com", "Hi", "Body");

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyEmailTransport", () => {
  beforeEach(() => {
    verify.mockReset().mockResolvedValue(true);
    createTransport.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not_configured without credentials", async () => {
    stubGmailEnv({ EMAIL_SMTP_USER: "", EMAIL_SMTP_PASSWORD: "" });

    await expect(verifyEmailTransport()).resolves.toEqual({ ok: false, reason: "not_configured" });
  });

  it("reports the resolved endpoint when authentication succeeds", async () => {
    const env = stubGmailEnv();

    await expect(verifyEmailTransport()).resolves.toEqual({
      ok: true,
      host: "smtp.gmail.com",
      port: 465,
      from: env.EMAIL_SMTP_USER,
    });
  });

  it("reports a safe failure reason when authentication fails", async () => {
    const env = stubGmailEnv();
    verify.mockRejectedValue(Object.assign(new Error(`bad creds ${env.EMAIL_SMTP_PASSWORD}`), { code: "EAUTH" }));

    const result = await verifyEmailTransport();

    expect(result).toEqual({ ok: false, reason: "smtp_verify_failed (EAUTH)" });
    expect(JSON.stringify(result)).not.toContain(env.EMAIL_SMTP_PASSWORD);
  });
});
