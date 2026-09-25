import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  rpc: vi.fn(),
  writeAuditEvent: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/audit/write", () => ({ writeAuditEvent: mocks.writeAuditEvent }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { cancelAdvanceAction, closeAdvanceAction, recordPartnerSettlementAction } from "./actions";

const OPERATOR = { kind: "operator", userId: "op-1" };
const ADVANCE = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OPERATOR);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("recordPartnerSettlementAction", () => {
  const valid = { currency: "GHS", direction: "from_partner", amount: "2500.00", reference: "BANK-123" };

  it("refuses anyone who is not an operator", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "seller", sellerAccountId: "s1" });
    await expect(recordPartnerSettlementAction(form(valid))).rejects.toThrow(/REDIRECT:\/login/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records in minor units with the operator as recorder, and audits", async () => {
    mocks.rpc.mockResolvedValue({ data: "txn-1", error: null });
    await expect(recordPartnerSettlementAction(form(valid))).rejects.toThrow(/saved=/);
    expect(mocks.rpc).toHaveBeenCalledWith("record_partner_settlement", {
      p_currency: "GHS",
      p_direction: "from_partner",
      p_amount_minor: 250000,
      p_reference: "BANK-123",
      p_recorded_by: "op-1",
    });
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "admin",
        actorId: "op-1",
        action: "financing.partner_settlement_recorded",
        entityId: "txn-1",
      }),
    );
  });

  it("says so when the reference was already recorded", async () => {
    await expect(recordPartnerSettlementAction(form(valid))).rejects.toThrow(/error=That%20reference%20is%20already/);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it("surfaces the function's cap refusal", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "to_partner: 0 already recorded of 100 due" } });
    await expect(recordPartnerSettlementAction(form({ ...valid, direction: "to_partner" }))).rejects.toThrow(
      /error=to_partner/,
    );
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it("validates direction, amount and reference before calling", async () => {
    await expect(recordPartnerSettlementAction(form({ ...valid, direction: "sideways" }))).rejects.toThrow(/error=/);
    await expect(recordPartnerSettlementAction(form({ ...valid, amount: "-1" }))).rejects.toThrow(/error=/);
    await expect(recordPartnerSettlementAction(form({ ...valid, reference: " " }))).rejects.toThrow(/error=/);
    await expect(recordPartnerSettlementAction(form({ ...valid, currency: "USD" }))).rejects.toThrow(/error=/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("closeAdvanceAction", () => {
  it("closes as defaulted with a reason, and audits", async () => {
    await expect(
      closeAdvanceAction(form({ advanceId: ADVANCE, state: "defaulted", reason: "Partner notice 12" })),
    ).rejects.toThrow(/saved=/);
    expect(mocks.rpc).toHaveBeenCalledWith("close_financing_advance", {
      p_advance_id: ADVANCE,
      p_state: "defaulted",
      p_reason: "Partner notice 12",
    });
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "financing.advance_defaulted", entityId: ADVANCE }),
    );
  });

  it("refuses other states and a missing reason", async () => {
    await expect(closeAdvanceAction(form({ advanceId: ADVANCE, state: "repaid", reason: "x" }))).rejects.toThrow(/error=/);
    await expect(closeAdvanceAction(form({ advanceId: ADVANCE, state: "written_off", reason: "" }))).rejects.toThrow(
      /error=Record%20why/,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the function's refusal without auditing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Only a disbursed advance can be closed." } });
    await expect(
      closeAdvanceAction(form({ advanceId: ADVANCE, state: "written_off", reason: "x" })),
    ).rejects.toThrow(/error=Only%20a%20disbursed/);
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });
});

describe("cancelAdvanceAction", () => {
  it("cancels an accepted advance and audits", async () => {
    await expect(cancelAdvanceAction(form({ advanceId: ADVANCE, reason: "Partner declined by email" }))).rejects.toThrow(
      /saved=/,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_financing_advance", {
      p_advance_id: ADVANCE,
      p_reason: "Partner declined by email",
    });
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "financing.advance_cancelled", actorId: "op-1" }),
    );
  });

  it("refuses a non-operator and a missing reason", async () => {
    await expect(cancelAdvanceAction(form({ advanceId: ADVANCE, reason: "" }))).rejects.toThrow(/error=Record%20why/);
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous" });
    await expect(cancelAdvanceAction(form({ advanceId: ADVANCE, reason: "x" }))).rejects.toThrow(/REDIRECT:\/login/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
