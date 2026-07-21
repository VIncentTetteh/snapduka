import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  refund: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: () => ({ refund: mocks.refund }) }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/payments/paystack/refund", { method: "POST", body: JSON.stringify(body) });
}

const OPERATOR_ACTOR = { kind: "operator" as const, authenticated: true, userId: "op1", email: "op@example.com", role: "operator" as const };

function adminMock({ order, attempt, priorRefundsTotal }: { order: Record<string, unknown> | null; attempt: Record<string, unknown> | null; priorRefundsTotal: number }) {
  const refundsInsert = vi.fn().mockResolvedValue({});
  const refundsNeq = vi.fn().mockResolvedValue({ data: [{ amount_minor: priorRefundsTotal }].filter((r) => r.amount_minor > 0) });
  const refundsEq = vi.fn().mockReturnValue({ neq: refundsNeq });
  const ordersUpdateEq2 = vi.fn().mockResolvedValue({});
  const ordersUpdateEq1 = vi.fn().mockReturnValue({ eq: ordersUpdateEq2 });
  const ordersUpdate = vi.fn().mockReturnValue({ eq: ordersUpdateEq1 });
  const from = vi.fn((table: string) => {
    if (table === "orders") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: order });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      return { select: vi.fn().mockReturnValue({ eq }), update: ordersUpdate };
    }
    if (table === "payment_attempts") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: attempt });
      const eq2 = vi.fn().mockReturnValue({ maybeSingle });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      return { select: vi.fn().mockReturnValue({ eq: eq1 }) };
    }
    if (table === "refunds") {
      return { select: vi.fn().mockReturnValue({ eq: refundsEq }), insert: refundsInsert };
    }
    return {};
  });
  return { from, refundsInsert, refundsEq, refundsNeq, ordersUpdate, ordersUpdateEq1, ordersUpdateEq2 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OPERATOR_ACTOR);
  mocks.refund.mockResolvedValue({ providerId: "ref_1", status: "processing" });
});

describe("POST /api/payments/paystack/refund", () => {
  it("rejects a refund that would exceed the order total once prior refunds are counted", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
        attempt: { id: "attempt-1", reference: "ref-abc" },
        priorRefundsTotal: 7_000,
      }),
    );

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 5_000 }));

    expect(response.status).toBe(400);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("allows a refund that fits within the remaining unrefunded balance", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
        attempt: { id: "attempt-1", reference: "ref-abc" },
        priorRefundsTotal: 7_000,
      }),
    );

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 3_000 }));

    expect(response.status).toBe(202);
    expect(mocks.refund).toHaveBeenCalledWith({ reference: "ref-abc", amountMinor: 3_000 });
  });

  it("rejects a refund request when order is already fully refunded", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
        attempt: { id: "attempt-1", reference: "ref-abc" },
        priorRefundsTotal: 10_000,
      }),
    );

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111" }));

    expect(response.status).toBe(409);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("stores Paystack's reported status instead of hardcoding 'processing' when the refund is already processed", async () => {
    const admin = adminMock({
      order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
      attempt: { id: "attempt-1", reference: "ref-abc" },
      priorRefundsTotal: 0,
    });
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.refund.mockResolvedValue({ providerId: "ref_processed", status: "processed" });

    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 4_000 }));

    expect(admin.refundsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_refund_id: "ref_processed", status: "completed" }),
    );
  });

  it("stores a failed status when Paystack reports the refund failed outright", async () => {
    const admin = adminMock({
      order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
      attempt: { id: "attempt-1", reference: "ref-abc" },
      priorRefundsTotal: 0,
    });
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.refund.mockResolvedValue({ providerId: "ref_failed", status: "failed" });

    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 4_000 }));

    expect(admin.refundsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_refund_id: "ref_failed", status: "failed" }),
    );
  });

  it("falls back to 'processing' for any other reported status", async () => {
    const admin = adminMock({
      order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
      attempt: { id: "attempt-1", reference: "ref-abc" },
      priorRefundsTotal: 0,
    });
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.refund.mockResolvedValue({ providerId: "ref_pending", status: "pending" });

    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 4_000 }));

    expect(admin.refundsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_refund_id: "ref_pending", status: "processing" }),
    );
  });

  it("excludes failed refunds from the cumulative refund total so a failed attempt doesn't permanently block a retry", async () => {
    const admin = adminMock({
      order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
      attempt: { id: "attempt-1", reference: "ref-abc" },
      priorRefundsTotal: 0,
    });
    mocks.createAdminClient.mockReturnValue(admin);

    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 4_000 }));

    expect(admin.refundsEq).toHaveBeenCalledWith("order_id", "order-1");
    expect(admin.refundsNeq).toHaveBeenCalledWith("status", "failed");
  });

  it("marks the order as refund-processing immediately, guarded so an already partial/completed order isn't downgraded", async () => {
    const admin = adminMock({
      order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
      attempt: { id: "attempt-1", reference: "ref-abc" },
      priorRefundsTotal: 0,
    });
    mocks.createAdminClient.mockReturnValue(admin);

    await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 4_000 }));

    expect(admin.ordersUpdate).toHaveBeenCalledWith({ refund_status: "processing" });
    expect(admin.ordersUpdateEq1).toHaveBeenCalledWith("id", "order-1");
    expect(admin.ordersUpdateEq2).toHaveBeenCalledWith("refund_status", "none");
  });
});
