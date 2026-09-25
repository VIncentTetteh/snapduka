import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lastInbound: vi.fn(),
  template: vi.fn(),
  rpc: vi.fn(),
  sendGraphText: vi.fn(),
  sendGraphTemplate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./vault", () => ({ readWhatsAppVaultSecrets: async () => null, cachedWhatsAppVaultSecrets: () => null }));
vi.mock("./graph", () => ({ sendGraphText: mocks.sendGraphText, sendGraphTemplate: mocks.sendGraphTemplate }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "wa_conversations"
        ? {
            select: () => ({
              eq: () => ({ not: () => ({ order: () => ({ limit: () => ({ maybeSingle: mocks.lastInbound }) }) }) }),
            }),
          }
        : { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.template }) }) }) },
    rpc: mocks.rpc,
  }),
}));

import { isWithinServiceWindow, sendFreeFormMessage, sendTemplateMessage } from "./outbound";

const NOW = new Date("2026-09-25T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
  process.env.WHATSAPP_ACCESS_TOKEN = "t";
  mocks.lastInbound.mockResolvedValue({ data: { last_inbound_at: "2026-09-25T11:00:00Z" }, error: null });
  mocks.template.mockResolvedValue({ data: { status: "approved" }, error: null });
  mocks.rpc.mockResolvedValue({ data: "m1", error: null });
  mocks.sendGraphText.mockResolvedValue({ ok: true, wamid: "wamid.1" });
  mocks.sendGraphTemplate.mockResolvedValue({ ok: true, wamid: "wamid.2" });
});

afterEach(() => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
});

describe("isWithinServiceWindow", () => {
  it.each([
    [null, false],
    ["2026-09-24T12:00:01Z", true],
    ["2026-09-24T12:00:00Z", false],
    ["not a date", false],
  ])("%s -> %s", (at, expected) => {
    expect(isWithinServiceWindow(at, NOW)).toBe(expected);
  });
});

describe("sendFreeFormMessage", () => {
  const base = { to: "+233201234567", text: "hi", sellerAccountId: "s1", author: "seller" as const, now: NOW };

  it("is not_configured without credentials", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    await expect(sendFreeFormMessage(base)).resolves.toEqual({ delivered: false, reason: "not_configured" });
    expect(mocks.sendGraphText).not.toHaveBeenCalled();
  });

  it("sends inside the window and records the message against the conversation", async () => {
    await expect(sendFreeFormMessage({ ...base, conversationId: "c1", authorUserId: "u1" })).resolves.toEqual({
      delivered: true,
      wamid: "wamid.1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "wa_record_outbound",
      expect.objectContaining({
        p_buyer_phone: "+233201234567",
        p_wamid: "wamid.1",
        p_type: "text",
        p_body: "hi",
        p_author: "seller",
        p_status: "sent",
        p_author_user_id: "u1",
        p_conversation_id: "c1",
      }),
    );
  });

  it("refuses outside the window without calling Meta", async () => {
    mocks.lastInbound.mockResolvedValue({ data: { last_inbound_at: "2026-09-23T12:00:00Z" }, error: null });
    await expect(sendFreeFormMessage(base)).resolves.toEqual({ delivered: false, reason: "outside_window" });
    expect(mocks.sendGraphText).not.toHaveBeenCalled();
  });

  it("records a permanent Meta failure as a failed message", async () => {
    mocks.sendGraphText.mockResolvedValue({ ok: false, reason: "rejected", detail: "400/131026" });
    await expect(sendFreeFormMessage(base)).resolves.toEqual({ delivered: false, reason: "rejected" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "wa_record_outbound",
      expect.objectContaining({ p_status: "failed", p_wamid: undefined }),
    );
  });
});

describe("sendTemplateMessage", () => {
  it("refuses a template whose approval is not recorded", async () => {
    mocks.template.mockResolvedValue({ data: { status: "submitted" }, error: null });
    await expect(
      sendTemplateMessage({
        to: "+233201234567",
        call: { name: "order_confirmed", params: { reference: "R", shop_name: "S", tracking_url: "u" } },
        sellerAccountId: "s1",
        author: "system",
      }),
    ).resolves.toEqual({ delivered: false, reason: "template_not_approved" });
    expect(mocks.sendGraphTemplate).not.toHaveBeenCalled();
  });

  it("records the delivery code redacted", async () => {
    await sendTemplateMessage({
      to: "+233201234567",
      call: { name: "delivery_code", params: { code: "482913", reference: "SD-1" } },
      sellerAccountId: "s1",
      author: "system",
    });
    const recorded = mocks.rpc.mock.calls[0][1];
    expect(recorded.p_template_name).toBe("delivery_code");
    expect(recorded.p_body).not.toContain("482913");
  });

  it("keeps a seller-audience template out of the buyer inbox", async () => {
    await sendTemplateMessage({
      to: "+233209999999",
      call: { name: "payout_sent", params: { amount: "GHS 10", destination: "MTN", reference: "P1" } },
      sellerAccountId: "s1",
      author: "system",
    });
    expect(mocks.sendGraphTemplate).toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
