import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBnplProviderById: vi.fn(),
  attempt: { id: "att-1", reference: "ref-1", provider: "paystack", route_reason: "preferred" } as Record<string, string>,
  createAdminClient: vi.fn(),
  refund: vi.fn(),
  rpc: vi.fn(),
  updates: [] as { table: string; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/bnpl/registry", () => ({ getBnplProviderById: mocks.getBnplProviderById }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: () => ({ refund: mocks.refund }) }));

import { startRefund } from "./refunds";

const ORDER = { id: "order-1", seller_account_id: "seller-1", total_minor: 10_150, payment_status: "paid" };

function admin() {
  mocks.updates.length = 0;
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order"]) c[m] = () => c;
    c.maybeSingle = async () => result;
    c.limit = async () => result;
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return c;
  };
  return {
    rpc: mocks.rpc,
    from(table: string) {
      if (table === "orders") {
        return {
          ...chain({ data: ORDER }),
          update: (values: Record<string, unknown>) => {
            mocks.updates.push({ table, values });
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          },
        };
      }
      if (table === "payment_attempts") return chain({ data: [mocks.attempt] });
      return {
        ...chain({ data: [] }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "refund-1" }, error: null }) }) }),
        update: (values: Record<string, unknown>) => {
          mocks.updates.push({ table, values });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attempt = { id: "att-1", reference: "ref-1", provider: "paystack", route_reason: "preferred" };
  mocks.createAdminClient.mockReturnValue(admin());
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("startRefund", () => {
  it("claws the refund back from the seller's wallet when Paystack completes it immediately", async () => {
    mocks.refund.mockResolvedValue({ providerId: "rf_1", status: "processed" });

    const result = await startRefund({ orderId: "order-1" });

    expect(result).toEqual({ ok: true, refundId: "refund-1", status: "completed" });
    expect(mocks.rpc).toHaveBeenCalledWith("apply_refund_to_ledger", { p_refund_id: "refund-1" });
  });

  it("leaves the clawback to the webhook while the refund is still processing", async () => {
    mocks.refund.mockResolvedValue({ providerId: "rf_1", status: "pending" });

    const result = await startRefund({ orderId: "order-1" });

    expect(result).toMatchObject({ ok: true, status: "processing" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports a refund Paystack rejected as a failure, not as in progress", async () => {
    mocks.refund.mockResolvedValue({ providerId: "rf_1", status: "failed" });

    const result = await startRefund({ orderId: "order-1" });

    expect(result).toEqual({ ok: false, reason: "provider_failed" });
    expect(mocks.updates.some((u) => u.table === "orders")).toBe(false);
  });

  it("refunds a BNPL order through the partner that paid for it, never Paystack", async () => {
    mocks.attempt = { id: "att-1", reference: "ref-1", provider: "bnpl", route_reason: "bnpl:sandbox" };
    const partnerRefund = vi.fn().mockResolvedValue({ providerId: "sbxrf_ref-1", status: "processed" });
    mocks.getBnplProviderById.mockReturnValue({ refund: partnerRefund });

    const result = await startRefund({ orderId: "order-1" });

    expect(mocks.getBnplProviderById).toHaveBeenCalledWith("sandbox");
    expect(partnerRefund).toHaveBeenCalledWith({ reference: "ref-1", amountMinor: 10_150 });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, status: "completed" });
  });

  it("fails cleanly when the BNPL partner is not available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.attempt = { id: "att-1", reference: "ref-1", provider: "bnpl", route_reason: "bnpl:gone" };
    mocks.getBnplProviderById.mockReturnValue(null);
    expect(await startRefund({ orderId: "order-1" })).toEqual({ ok: false, reason: "provider_failed" });
  });
});
