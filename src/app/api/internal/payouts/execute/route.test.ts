import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransfer: vi.fn(),
  verifyTransfer: vi.fn(),
  rpc: vi.fn(),
  approved: vi.fn(),
  stale: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: () => true }));

vi.mock("@/lib/payments/paystack", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/paystack")>(
    "@/lib/payments/paystack",
  );
  return {
    ...actual,
    paystackProvider: () => ({
      createTransfer: mocks.createTransfer,
      verifyTransfer: mocks.verifyTransfer,
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: mocks.approved }),
          is: () => ({ lt: () => ({ limit: mocks.stale }) }),
        }),
      }),
      _table: table,
    }),
    rpc: (name: string, args: unknown) => {
      const result = mocks.rpc(name, args);
      return { maybeSingle: () => Promise.resolve(result), then: undefined, ...result };
    },
  }),
}));

import { PaystackApiError } from "@/lib/payments/paystack";
import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/payouts/execute", { method: "POST" });
}

const claim = {
  payout_id: "payout-1",
  reference: "PO-TEST0001",
  net_minor: 9_900,
  currency: "GHS",
  recipient_code: "RCP_x",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.approved.mockResolvedValue({ data: [{ id: "payout-1" }] });
  mocks.stale.mockResolvedValue({ data: [] });
  mocks.rpc.mockImplementation((name: string) =>
    name === "claim_payout_for_transfer" ? { data: claim } : { data: null },
  );
});

describe("payout execute worker", () => {
  it("sends an approved payout and records the provider result", async () => {
    mocks.createTransfer.mockResolvedValue({
      transferCode: "TRF_1",
      transferId: "99",
      status: "pending",
    });

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
    // Our own reference goes to Paystack so a retry is deduped provider-side.
    expect(mocks.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: "PO-TEST0001", amountMinor: 9_900 }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_payout_transfer",
      expect.objectContaining({ p_transfer_code: "TRF_1", p_provider_status: "pending" }),
    );
  });

  /**
   * Regression. This previously keyed on words in the error message, and
   * silently missed Paystack's real refusal — "You cannot initiate third party
   * payouts as a starter business" — leaving the payout stuck in 'processing'
   * with no reason recorded and the seller's balance held indefinitely.
   */
  it("requeues with a reason when Paystack refuses", async () => {
    mocks.createTransfer.mockRejectedValue(
      new PaystackApiError("You cannot initiate third party payouts as a starter business", 400),
    );

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "release_payout_claim",
      expect.objectContaining({
        p_payout_id: "payout-1",
        p_reason: expect.stringContaining("starter business"),
      }),
    );
  });

  /**
   * The opposite case, and the one that costs money to get wrong: a timeout is
   * not evidence the transfer did not happen. The row must stay claimed so the
   * sweeper can ask Paystack, rather than being requeued and sent twice.
   */
  it("keeps the claim when the network fails, so nothing is sent twice", async () => {
    mocks.createTransfer.mockRejectedValue(new Error("socket hang up"));

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.rpc).not.toHaveBeenCalledWith("release_payout_claim", expect.anything());
  });

  it("treats an OTP requirement as a hard failure and never tries to solve it", async () => {
    mocks.createTransfer.mockResolvedValue({
      transferCode: "TRF_2",
      transferId: "100",
      status: "otp",
    });

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_payout_transfer",
      expect.objectContaining({ p_provider_status: "otp" }),
    );
  });

  it("skips a destination with no provider recipient", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      name === "claim_payout_for_transfer"
        ? { data: { ...claim, recipient_code: null } }
        : { data: null },
    );

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.createTransfer).not.toHaveBeenCalled();
  });
});
