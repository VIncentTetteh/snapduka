import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  rpc: vi.fn(),
  writeAuditEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/audit/write", () => ({ writeAuditEvent: mocks.writeAuditEvent }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { resolveProtectDisputeAction, writeOffDebtAction } from "./protect-actions";

const OPERATOR = { kind: "operator", userId: "op-1" };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OPERATOR);
});

describe("resolveProtectDisputeAction", () => {
  it("refuses anyone who is not an operator", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "seller", sellerAccountId: "s1" });
    await expect(resolveProtectDisputeAction(form({ outcome: "refund", note: "x" }))).rejects.toThrow(/REDIRECT:\/login/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a written finding", async () => {
    await expect(
      resolveProtectDisputeAction(form({ caseId: "c1", orderId: "o1", outcome: "refund", note: " " })),
    ).rejects.toThrow(/error=Write%20why/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("resolves, audits and confirms", async () => {
    mocks.rpc.mockResolvedValue({ data: "resolved", error: null });
    await expect(
      resolveProtectDisputeAction(form({ caseId: "c1", orderId: "o1", outcome: "refund", note: "No delivery." })),
    ).rejects.toThrow(/saved=/);
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_protect_dispute", {
      p_order_id: "o1",
      p_outcome: "refund",
      p_note: "No delivery.",
      p_operator_user_id: "op-1",
    });
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "protect_dispute_refund" }));
  });

  it("says so when the order is not in dispute", async () => {
    mocks.rpc.mockResolvedValue({ data: "not_disputed", error: null });
    await expect(
      resolveProtectDisputeAction(form({ caseId: "c1", orderId: "o1", outcome: "release", note: "ok" })),
    ).rejects.toThrow(/error=This%20order%20is%20not/);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});

describe("writeOffDebtAction", () => {
  it("converts to minor units and passes the idempotency key", async () => {
    mocks.rpc.mockResolvedValue({ data: "txn-1", error: null });
    await expect(
      writeOffDebtAction(form({ sellerId: "s1", currency: "GHS", amount: "12.50", reason: "Closed shop", idempotencyKey: "k1" })),
    ).rejects.toThrow(/saved=/);
    expect(mocks.rpc).toHaveBeenCalledWith("write_off_seller_debt", expect.objectContaining({
      p_amount_minor: 1250,
      p_idempotency_key: "k1",
      p_operator_user_id: "op-1",
    }));
  });

  it("surfaces the database's refusal (e.g. more than is owed)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "The seller owes 500; cannot write off 1250." } });
    await expect(
      writeOffDebtAction(form({ sellerId: "s1", currency: "GHS", amount: "12.50", reason: "x" })),
    ).rejects.toThrow(/error=The%20seller%20owes/);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    await expect(writeOffDebtAction(form({ sellerId: "s1", currency: "GHS", amount: "5", reason: "" }))).rejects.toThrow(/error=Record%20why/);
  });
});
