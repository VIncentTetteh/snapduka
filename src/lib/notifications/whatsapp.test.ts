import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  lastInboundAt: vi.fn(),
  sendFreeFormMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  shop: vi.fn(),
  seller: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/whatsapp/outbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/outbound")>();
  return {
    isWithinServiceWindow: actual.isWithinServiceWindow,
    lastInboundAt: mocks.lastInboundAt,
    sendFreeFormMessage: mocks.sendFreeFormMessage,
    sendTemplateMessage: mocks.sendTemplateMessage,
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: table === "shops" ? mocks.shop : mocks.seller }),
      }),
    }),
  }),
}));

import {
  PERMANENT_WHATSAPP_FAILURES,
  buyerInitiatedWhatsApp,
  isWhatsAppConfigured,
  sendDeliveryCodeWhatsApp,
  sendWhatsApp,
  sendWhatsAppTemplate,
  whatsAppTemplateForNotification,
} from "./whatsapp";

const ENV_KEYS = ["WHATSAPP_WEBHOOK_URL", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function configureCloud() {
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.lastInboundAt.mockResolvedValue(null);
  mocks.sendFreeFormMessage.mockResolvedValue({ delivered: true, wamid: "wamid.1" });
  mocks.sendTemplateMessage.mockResolvedValue({ delivered: true, wamid: "wamid.2" });
  mocks.shop.mockResolvedValue({ data: { display_name: "Ama's Shea" } });
  mocks.seller.mockResolvedValue({ data: { contact_phone: "+233209999999" }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
});

describe("isWhatsAppConfigured", () => {
  /**
   * This exists so callers can avoid OFFERING a channel the platform cannot
   * deliver on. The seller settings page showed a WhatsApp checkbox
   * unconditionally, so ticking it enqueued a buyer notification per order that
   * could only ever dead-letter — and nobody was told.
   */
  it("is false when no provider is wired up", async () => {
    expect(await isWhatsAppConfigured()).toBe(false);
  });

  it("is true once a legacy webhook is configured", async () => {
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";
    expect(await isWhatsAppConfigured()).toBe(true);
  });

  it("is true once the Cloud API is configured", async () => {
    configureCloud();
    expect(await isWhatsAppConfigured()).toBe(true);
  });

  it("answers without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";
    await isWhatsAppConfigured();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendWhatsApp — legacy transport (Cloud API unconfigured)", () => {
  it("reports not_configured rather than throwing when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsApp("+233201234567", "hi")).resolves.toEqual({
      delivered: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Unconfigured does not even consult the flag.
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("posts the recipient and text to the configured webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.WHATSAPP_WEBHOOK_URL = "https://provider.example/hook";

    await expect(sendWhatsApp("+233201234567", "Your order shipped")).resolves.toEqual({ delivered: true });
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

  it("stays on the legacy path while wa_outbound is off", async () => {
    configureCloud();
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await expect(sendWhatsApp("+233201234567", "hi", { sellerAccountId: "s1" })).resolves.toEqual({
      delivered: false,
      reason: "not_configured",
    });
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("wa_outbound", { sellerAccountId: "s1" });
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });
});

describe("sendWhatsApp — Cloud API", () => {
  beforeEach(configureCloud);

  it("sends free-form text inside the 24h window", async () => {
    mocks.lastInboundAt.mockResolvedValue(new Date(Date.now() - 60_000).toISOString());

    await expect(sendWhatsApp("233 20 123 4567", "hello", { sellerAccountId: "s1" })).resolves.toEqual({
      delivered: true,
      wamid: "wamid.1",
    });
    expect(mocks.sendFreeFormMessage).toHaveBeenCalledWith({
      to: "+233201234567",
      text: "hello",
      sellerAccountId: "s1",
      author: "system",
    });
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("falls back to the template outside the window, filling in the shop name", async () => {
    mocks.lastInboundAt.mockResolvedValue(new Date(Date.now() - 25 * 3_600_000).toISOString());

    await sendWhatsApp("+233201234567", "Your order is confirmed", {
      sellerAccountId: "s1",
      template: { name: "order_confirmed", params: { reference: "SD-1", tracking_url: "https://x/o/1" } },
    });

    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+233201234567",
        call: {
          name: "order_confirmed",
          params: { reference: "SD-1", tracking_url: "https://x/o/1", shop_name: "Ama's Shea" },
        },
      }),
    );
  });

  it("fails permanently outside the window with no template", async () => {
    const result = await sendWhatsApp("+233201234567", "hi", { sellerAccountId: "s1" });
    expect(result).toEqual({ delivered: false, reason: "outside_window" });
    expect(PERMANENT_WHATSAPP_FAILURES.has(result.reason ?? "")).toBe(true);
  });

  it("rejects a number that cannot be E.164", async () => {
    await expect(sendWhatsApp("12", "hi")).resolves.toEqual({ delivered: false, reason: "invalid_recipient" });
  });
});

describe("sendDeliveryCodeWhatsApp", () => {
  beforeEach(configureCloud);

  it("sends the delivery_code template to the buyer", async () => {
    await sendDeliveryCodeWhatsApp({
      buyerPhone: "+233201234567",
      code: "482913",
      reference: "SD-ABC",
      sellerAccountId: "s1",
    });
    expect(mocks.sendTemplateMessage).toHaveBeenCalledWith({
      to: "+233201234567",
      call: { name: "delivery_code", params: { code: "482913", reference: "SD-ABC" } },
      sellerAccountId: "s1",
      author: "system",
    });
    // Always the template, even inside an open window.
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });

  it("refuses to send the code to the seller's own phone", async () => {
    const result = await sendDeliveryCodeWhatsApp({
      buyerPhone: "233 20 999 9999",
      code: "482913",
      reference: "SD-ABC",
      sellerAccountId: "s1",
    });
    expect(result).toEqual({ delivered: false, reason: "seller_recipient" });
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("fails closed when the seller's phone cannot be read", async () => {
    mocks.seller.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(
      sendDeliveryCodeWhatsApp({ buyerPhone: "+233201234567", code: "1", reference: "R", sellerAccountId: "s1" }),
    ).rejects.toThrow(/verify/);
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("reports not_configured when the Cloud API is off, so the caller can use SMS", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await expect(
      sendDeliveryCodeWhatsApp({ buyerPhone: "+233201234567", code: "1", reference: "R", sellerAccountId: "s1" }),
    ).resolves.toEqual({ delivered: false, reason: "not_configured" });
  });
});

describe("sendWhatsAppTemplate", () => {
  it("is not_configured without the Cloud API", async () => {
    await expect(
      sendWhatsAppTemplate("+233201234567", { name: "payout_sent", params: {} }),
    ).resolves.toEqual({ delivered: false, reason: "not_configured" });
  });
});

describe("whatsAppTemplateForNotification", () => {
  it.each([
    ["order_placed", "order_confirmed"],
    ["payment_succeeded", "order_confirmed"],
    ["dispatched", "order_dispatched"],
  ])("maps %s to %s", (status, name) => {
    expect(
      whatsAppTemplateForNotification("order_update", { reference: "SD-1", status }, "https://x/o/t")?.name,
    ).toBe(name);
  });

  it("has no template for events Meta has not approved one for", () => {
    expect(whatsAppTemplateForNotification("order_update", { reference: "SD-1", status: "cancelled" }, "u")).toBeNull();
    expect(whatsAppTemplateForNotification("creator_commission_earned", {}, "u")).toBeNull();
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
