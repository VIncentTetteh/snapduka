import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  isFeatureEnabled: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  sendSms: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/notifications/sms", () => ({ sendSms: mocks.sendSms }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendWhatsAppTemplate: mocks.sendWhatsAppTemplate }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ insert: mocks.insert }) }),
}));

import { duePeriods, isWorthSending, runSellerDigests } from "./digest";

const TUESDAY = new Date("2026-09-29T07:00:00Z");
const MONDAY = new Date("2026-09-28T07:00:00Z");
const SELLER = { seller_account_id: "s1", contact_phone: "+233201000001", shop_name: "Kofi Shoes", currency: "GHS" };
const BUSY = { orders_count: 3, paid_revenue_minor: 30000, to_fulfil: 2, unread_conversations: 1 };

function dueOnce(sellers: unknown[], summary: unknown = BUSY) {
  let served = false;
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "seller_digest_due") {
      const data = served ? [] : sellers;
      served = true;
      return { data, error: null };
    }
    return { data: [summary], error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.sendWhatsAppTemplate.mockResolvedValue({ delivered: true });
  mocks.sendSms.mockResolvedValue({ delivered: true });
});

describe("duePeriods", () => {
  it("is daily on a Tuesday, covering yesterday", () => {
    expect(duePeriods(TUESDAY)).toEqual([
      {
        frequency: "daily",
        from: new Date("2026-09-28T00:00:00Z"),
        to: new Date("2026-09-29T00:00:00Z"),
        label: "yesterday",
      },
    ]);
  });

  it("adds the weekly digest on Mondays", () => {
    expect(duePeriods(MONDAY).map((period) => period.frequency)).toEqual(["daily", "weekly"]);
  });
});

describe("runSellerDigests", () => {
  it("sends by WhatsApp template and records it", async () => {
    dueOnce([SELLER]);

    await expect(runSellerDigests(TUESDAY)).resolves.toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      "+233201000001",
      {
        name: "seller_digest",
        params: expect.objectContaining({ shop_name: "Kofi Shoes", orders: "3", to_fulfil: "2", unread: "1", period: "yesterday" }),
      },
      { sellerAccountId: "s1" },
    );
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ seller_account_id: "s1", period_start: "2026-09-29", frequency: "daily", status: "sent", channel: "whatsapp" }),
    );
  });

  it("falls back to SMS when WhatsApp cannot deliver", async () => {
    dueOnce([SELLER]);
    mocks.sendWhatsAppTemplate.mockResolvedValue({ delivered: false, reason: "template_not_approved" });

    await runSellerDigests(TUESDAY);

    expect(mocks.sendSms.mock.calls[0][1]).toMatch(/^SnapDuka summary for Kofi Shoes \(yesterday\): 3 new orders/);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", channel: "sms" }));
  });

  it("skips a period with nothing to say", async () => {
    dueOnce([SELLER], { orders_count: 0, paid_revenue_minor: 0, to_fulfil: 0, unread_conversations: 0 });
    await expect(runSellerDigests(TUESDAY)).resolves.toMatchObject({ skipped: 1, sent: 0 });
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
  });

  it("leaves flagged-off sellers unrecorded so they still count once the flag reaches them", async () => {
    dueOnce([SELLER]);
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await runSellerDigests(TUESDAY);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("records a failure when neither channel delivers", async () => {
    dueOnce([SELLER]);
    mocks.sendWhatsAppTemplate.mockResolvedValue({ delivered: false, reason: "not_configured" });
    mocks.sendSms.mockResolvedValue({ delivered: false, reason: "not_configured" });
    await expect(runSellerDigests(TUESDAY)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", detail: "whatsapp:not_configured sms:not_configured" }),
    );
  });
});

describe("isWorthSending", () => {
  it("wants something to report", () => {
    expect(isWorthSending({ ordersCount: 0, paidRevenueMinor: 0, toFulfil: 0, unreadConversations: 0 })).toBe(false);
    expect(isWorthSending({ ordersCount: 0, paidRevenueMinor: 0, toFulfil: 1, unreadConversations: 0 })).toBe(true);
  });
});
