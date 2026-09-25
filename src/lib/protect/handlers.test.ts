import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  order: vi.fn(),
  sendSms: vi.fn(),
  sendWhatsApp: vi.fn(),
  startRefund: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/sms", () => ({ sendSms: mocks.sendSms }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendDeliveryCodeWhatsApp: mocks.sendWhatsApp }));
vi.mock("@/lib/payments/refunds", () => ({ startRefund: mocks.startRefund }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.order() }) }) }) }),
  }),
}));

import { deliverCode, refundAfterDispute } from "./handlers";

const event = (payload: Record<string, string>) => ({
  id: 7,
  aggregate: "order",
  aggregate_id: "order-1",
  event_type: "protect.code_issued",
  payload,
  attempts: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.order.mockReturnValue({
    public_reference: "SD-ABC",
    tracking_token: "tok-1",
    buyer_snapshot: { phone: "+233241110002", name: "Ama" },
    seller_account_id: "seller-1",
  });
  mocks.sendWhatsApp.mockResolvedValue({ delivered: false, reason: "not_configured" });
});

describe("deliverCode", () => {
  it("sends over WhatsApp when it can, and then not by SMS", async () => {
    mocks.sendWhatsApp.mockResolvedValue({ delivered: true });

    await deliverCode(event({ code: "123456" }));

    expect(mocks.sendWhatsApp).toHaveBeenCalledWith({
      buyerPhone: "+233241110002",
      code: "123456",
      reference: "SD-ABC",
      sellerAccountId: "seller-1",
    });
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("redact_domain_event_keys", { p_id: 7, p_keys: ["code"] });
  });

  it("keeps the code for a retry when WhatsApp fails transiently", async () => {
    mocks.sendWhatsApp.mockRejectedValue(new Error("Graph API 500"));
    await expect(deliverCode(event({ code: "123456" }))).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("texts the code to the buyer's phone and then redacts it from the outbox", async () => {
    mocks.sendSms.mockResolvedValue({ delivered: true });

    await deliverCode(event({ code: "123456" }));

    expect(mocks.sendSms).toHaveBeenCalledWith("+233241110002", expect.stringContaining("123456"));
    expect(mocks.sendSms.mock.calls[0]![1]).toContain("/orders/tok-1");
    expect(mocks.rpc).toHaveBeenCalledWith("redact_domain_event_keys", { p_id: 7, p_keys: ["code"] });
  });

  it("still redacts when SMS is not configured; the buyer can reissue from the tracking page", async () => {
    mocks.sendSms.mockResolvedValue({ delivered: false, reason: "not_configured" });
    await deliverCode(event({ code: "123456" }));
    expect(mocks.rpc).toHaveBeenCalledWith("redact_domain_event_keys", expect.anything());
  });

  it("keeps the code for a retry when the provider errors", async () => {
    mocks.sendSms.mockRejectedValue(new Error("SMS provider request failed."));
    await expect(deliverCode(event({ code: "123456" }))).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is a no-op once the code has been redacted", async () => {
    await deliverCode(event({}));
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });
});

describe("refundAfterDispute", () => {
  it.each([
    [{ ok: true, refundId: "r1", status: "processing" }],
    [{ ok: false, reason: "fully_refunded" }],
    [{ ok: false, reason: "in_flight" }],
  ])("treats %o as done", async (result) => {
    mocks.startRefund.mockResolvedValue(result);
    await expect(refundAfterDispute(event({}))).resolves.toBeUndefined();
    expect(mocks.startRefund).toHaveBeenCalledWith({ orderId: "order-1" });
  });

  it("throws on a real failure so the outbox retries", async () => {
    mocks.startRefund.mockResolvedValue({ ok: false, reason: "provider_failed" });
    await expect(refundAfterDispute(event({}))).rejects.toThrow("provider_failed");
  });
});
