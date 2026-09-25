import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  tables: {} as Record<string, unknown>,
  isFeatureEnabled: vi.fn(),
  partner: {
    id: "sandbox",
    status: vi.fn(),
    requestDisbursement: vi.fn(),
    sendRepayment: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/audit/write", () => ({ writeAuditEvent: mocks.audit }));
vi.mock("@/lib/financing/partner", () => ({
  getFinancingPartner: (id: string) =>
    id === "sandbox" ? mocks.partner : { id: "not_configured", status: () => "not_configured" },
}));
// A chainable stand-in for the PostgREST builder: every filter returns the
// builder, and awaiting it (or maybeSingle/single) yields the table's canned row.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const result = () => {
        const value = mocks.tables[table];
        return Promise.resolve({ data: value ?? null, error: null });
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "update", "insert"]) builder[method] = () => builder;
      builder.maybeSingle = result;
      builder.single = result;
      builder.then = (resolve: (value: unknown) => unknown) => result().then(resolve);
      return builder;
    },
  }),
}));

import { acceptFinancingOffer, applyFinancingPartnerEvent, getCapitalOverview, settleWithPartners } from "./service";

const SELLER = "22222222-2222-4222-8222-222222222222";
const OFFER = "33333333-3333-4333-8333-333333333333";
const ADVANCE = "44444444-4444-4444-8444-444444444444";

const ELIGIBILITY = {
  eligible: true,
  reasons: [],
  country: "GH",
  currency: "GHS",
  partner: "sandbox",
  gmv90dMinor: 750_000,
  orders90d: 25,
  refundRateBps: 0,
  chargebackRateBps: 0,
  trustTier: "gold",
  verified: true,
  accountAgeDays: 400,
  offer: { principalMinor: 187_500 },
};

function rpcAnswers(answers: Record<string, { data: unknown; error?: { message: string } | null }>) {
  mocks.rpc.mockImplementation(async (name: string) => {
    const answer = answers[name];
    if (!answer) throw new Error(`unexpected rpc ${name}`);
    return { data: answer.data, error: answer.error ?? null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.partner.status.mockReturnValue("ready");
  mocks.audit.mockResolvedValue(true);
});

describe("getCapitalOverview", () => {
  it("is off, and touches nothing, when the flag is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await getCapitalOverview({ sellerAccountId: SELLER, country: "GH" })).toEqual({ enabled: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not mint an offer the partner cannot fund", async () => {
    mocks.partner.status.mockReturnValue("not_configured");
    rpcAnswers({ financing_eligibility: { data: ELIGIBILITY } });
    mocks.tables.financing_advances = [];
    const overview = await getCapitalOverview({ sellerAccountId: SELLER, country: "GH" });
    expect(overview).toMatchObject({ enabled: true, partnerReady: false, offer: null });
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_financing_offer", expect.anything());
  });

  it("returns the offer for an eligible seller", async () => {
    rpcAnswers({ financing_eligibility: { data: ELIGIBILITY }, create_financing_offer: { data: OFFER } });
    mocks.tables.financing_offers = {
      id: OFFER, currency: "GHS", principal_minor: 187_500, fee_bps: 600, fee_minor: 11_250,
      total_repayable_minor: 198_750, sweep_bps: 1_500, terms_version: "v1", expires_at: "2026-10-09T00:00:00Z",
    };
    mocks.tables.financing_advances = [];
    const overview = await getCapitalOverview({ sellerAccountId: SELLER, country: "GH" });
    expect(overview.enabled && overview.offer).toMatchObject({ id: OFFER, totalRepayableMinor: 198_750, sweepBps: 1_500 });
  });
});

describe("acceptFinancingOffer", () => {
  const input = { sellerAccountId: SELLER, userId: "u1", offerId: OFFER, expectedTotalMinor: 198_750, termsVersion: "v1" };

  beforeEach(() => {
    mocks.tables.financing_offers = { id: OFFER, partner: "sandbox", country: "GH" };
    mocks.tables.financing_advances = {
      id: ADVANCE, seller_account_id: SELLER, country: "GH", currency: "GHS",
      principal_minor: 187_500, fee_minor: 11_250, total_repayable_minor: 198_750,
    };
  });

  it("refuses a terms version this build does not render", async () => {
    const result = await acceptFinancingOffer({ ...input, termsVersion: "v2" });
    expect(result).toMatchObject({ ok: false, reason: "refused" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records acceptance, asks the partner, and posts the disbursement when funded", async () => {
    rpcAnswers({ accept_financing_offer: { data: ADVANCE }, record_financing_disbursement: { data: "txn" } });
    mocks.partner.requestDisbursement.mockResolvedValue({ status: "funded", partnerReference: "P-1" });
    expect(await acceptFinancingOffer(input)).toEqual({ ok: true, advanceId: ADVANCE, state: "disbursed" });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_financing_offer", {
      p_offer_id: OFFER, p_seller_account_id: SELLER, p_accepted_by: "u1",
      p_expected_total_minor: 198_750, p_terms_version: "v1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_financing_disbursement", { p_advance_id: ADVANCE, p_partner_reference: "P-1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "financing.offer_accepted" }));
  });

  it("cancels the advance when the partner declines", async () => {
    rpcAnswers({ accept_financing_offer: { data: ADVANCE }, cancel_financing_advance: { data: null } });
    mocks.partner.requestDisbursement.mockResolvedValue({ status: "declined", reason: "credit" });
    expect(await acceptFinancingOffer(input)).toMatchObject({ ok: false, reason: "declined" });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_financing_advance", { p_advance_id: ADVANCE, p_reason: "credit" });
  });

  it("never cancels on a network error: the partner may have funded it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcAnswers({ accept_financing_offer: { data: ADVANCE } });
    mocks.partner.requestDisbursement.mockRejectedValue(new Error("timeout"));
    expect(await acceptFinancingOffer(input)).toEqual({ ok: true, advanceId: ADVANCE, state: "awaiting_partner" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("cancel_financing_advance", expect.anything());
  });

  it("surfaces the database's refusal to the seller", async () => {
    rpcAnswers({ accept_financing_offer: { data: null, error: { message: "You no longer qualify for this offer." } } });
    expect(await acceptFinancingOffer(input)).toEqual({
      ok: false, reason: "refused", message: "You no longer qualify for this offer.",
    });
    expect(mocks.partner.requestDisbursement).not.toHaveBeenCalled();
  });
});

describe("applyFinancingPartnerEvent", () => {
  it("ignores an event about another partner's advance", async () => {
    mocks.tables.financing_advances = { id: ADVANCE, partner: "other_lender", state: "accepted" };
    const result = await applyFinancingPartnerEvent("sandbox", {
      type: "advance.funded", advanceId: ADVANCE, partnerReference: "P-9",
    });
    expect(result).toEqual({ applied: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("books funding landing, namespaced by partner", async () => {
    rpcAnswers({ record_partner_settlement: { data: "txn" } });
    await applyFinancingPartnerEvent("sandbox", { type: "funding.settled", currency: "GHS", amountMinor: 30_000, reference: "B-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("record_partner_settlement", {
      p_currency: "GHS", p_direction: "from_partner", p_amount_minor: 30_000, p_reference: "sandbox:B-1",
    });
  });
});

describe("settleWithPartners", () => {
  it("pays what is due, then records it under a replay-stable reference", async () => {
    rpcAnswers({
      financing_partner_amounts_due: {
        data: [{ currency: "GHS", partner: "sandbox", partners: 1, remitted_minor: 30_900, transferred_minor: 0, due_minor: 30_900 }],
      },
      record_partner_settlement: { data: "txn" },
    });
    mocks.partner.sendRepayment.mockResolvedValue({ status: "sent", partnerReference: "R-1" });
    expect(await settleWithPartners()).toEqual([{ currency: "GHS", dueMinor: 30_900, status: "sent" }]);
    expect(mocks.partner.sendRepayment).toHaveBeenCalledWith({ currency: "GHS", amountMinor: 30_900, reference: "rep-GHS-30900" });
    expect(mocks.rpc).toHaveBeenCalledWith("record_partner_settlement", {
      p_currency: "GHS", p_direction: "to_partner", p_amount_minor: 30_900, p_reference: "sandbox:rep-GHS-30900",
    });
  });

  it("refuses to guess when a currency has more than one partner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcAnswers({
      financing_partner_amounts_due: {
        data: [{ currency: "GHS", partner: "a", partners: 2, remitted_minor: 10, transferred_minor: 0, due_minor: 10 }],
      },
    });
    expect((await settleWithPartners())[0].status).toBe("ambiguous_partner");
    expect(mocks.partner.sendRepayment).not.toHaveBeenCalled();
  });

  it("records nothing when the transfer fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcAnswers({
      financing_partner_amounts_due: {
        data: [{ currency: "GHS", partner: "sandbox", partners: 1, remitted_minor: 100, transferred_minor: 0, due_minor: 100 }],
      },
    });
    mocks.partner.sendRepayment.mockRejectedValue(new Error("down"));
    expect((await settleWithPartners())[0].status).toBe("failed");
    expect(mocks.rpc).not.toHaveBeenCalledWith("record_partner_settlement", expect.anything());
  });
});
