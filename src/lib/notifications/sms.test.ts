import { afterEach, describe, expect, it, vi } from "vitest";

import { isSmsConfigured, sendSms } from "@/lib/notifications/sms";

describe("isSmsConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true only when all three Techieszon vars are present", () => {
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "test-key");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");

    expect(isSmsConfigured()).toBe(true);
  });

  it.each(["TECHIESZON_SMS_API_KEY", "TECHIESZON_SMS_API_URL", "TECHIESZON_SMS_SENDER_ID"])(
    "is false when %s is missing",
    (missing) => {
      vi.stubEnv("TECHIESZON_SMS_API_KEY", "test-key");
      vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
      vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");
      vi.stubEnv(missing, "");

      expect(isSmsConfigured()).toBe(false);
    },
  );

  it("makes no network request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "test-key");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");

    isSmsConfigured();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("sendSms", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports not_configured when any Techieszon env var is missing", async () => {
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");

    const result = await sendSms("+233201234567", "hello");

    expect(result).toEqual({ delivered: false, reason: "not_configured" });
  });

  it("calls the Techieszon send-sms endpoint with the expected query params", async () => {
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "test-key");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms("+233 20 123 4567", "Your order is shipped.");

    expect(result).toEqual({ delivered: true });
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://smsapp.techieszon.com/sms/api");
    expect(calledUrl.searchParams.get("action")).toBe("send-sms");
    expect(calledUrl.searchParams.get("api_key")).toBe("test-key");
    expect(calledUrl.searchParams.get("to")).toBe("233201234567");
    expect(calledUrl.searchParams.get("from")).toBe("Techieszon");
    expect(calledUrl.searchParams.get("sms")).toBe("Your order is shipped.");
  });

  it("throws when the provider rejects the request", async () => {
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "test-key");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(sendSms("+233201234567", "hello")).rejects.toThrow("SMS provider rejected the notification.");
  });

  it("never leaks the API key or phone number from a raw fetch failure", async () => {
    vi.stubEnv("TECHIESZON_SMS_API_KEY", "super-secret-key");
    vi.stubEnv("TECHIESZON_SMS_API_URL", "https://smsapp.techieszon.com/sms/api");
    vi.stubEnv("TECHIESZON_SMS_SENDER_ID", "Techieszon");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: https://smsapp.techieszon.com/sms/api?api_key=super-secret-key&to=233201234567")),
    );

    await expect(sendSms("+233201234567", "hello")).rejects.toThrow("SMS provider request failed.");
    try {
      await sendSms("+233201234567", "hello");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-key");
      expect((error as Error).message).not.toContain("233201234567");
    }
  });
});
