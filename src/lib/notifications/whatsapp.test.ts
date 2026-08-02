import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buyerInitiatedWhatsApp,
  isWhatsAppConfigured,
  sendWhatsApp,
} from "./whatsapp";

const ORIGINAL = process.env.WHATSAPP_WEBHOOK_URL;

beforeEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL === undefined) delete process.env.WHATSAPP_WEBHOOK_URL;
  else process.env.WHATSAPP_WEBHOOK_URL = ORIGINAL;
});

describe("isWhatsAppConfigured", () => {
  /**
   * This exists so callers can avoid OFFERING a channel the platform cannot
   * deliver on. The seller settings page showed a WhatsApp checkbox
   * unconditionally, so ticking it enqueued a buyer notification per order that
   * could only ever dead-letter — and nobody was told.
   */
  it("is false when no provider is wired up", () => {
    expect(isWhatsAppConfigured()).toBe(false);
  });

  it("is true once a webhook is configured", () => {
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";
    expect(isWhatsAppConfigured()).toBe(true);
  });

  it("answers without making a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";

    isWhatsAppConfigured();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendWhatsApp", () => {
  it("reports not_configured rather than throwing when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsApp("+233201234567", "hi")).resolves.toEqual({
      delivered: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the recipient and text to the configured webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";

    await expect(sendWhatsApp("+233201234567", "Your order shipped")).resolves.toEqual({
      delivered: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/hook",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ to: "+233201234567", text: "Your order shipped" }),
      }),
    );
  });

  // A provider that answers with a failure IS transient, unlike a missing
  // provider, so this throws and the worker retries it.
  it("throws when the provider rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";

    await expect(sendWhatsApp("+233201234567", "hi")).rejects.toThrow(/rejected/i);
  });
});

describe("buyerInitiatedWhatsApp", () => {
  // Buyer-initiated wa.me links need no provider at all, which is why they keep
  // working when the outbound channel is unconfigured.
  it("builds a wa.me link with the number stripped to digits", () => {
    expect(buyerInitiatedWhatsApp("+233 20 123 4567", "Hello there")).toBe(
      "https://wa.me/233201234567?text=Hello%20there",
    );
  });
});
