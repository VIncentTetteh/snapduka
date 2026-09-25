import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCreatorContext: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  paystackProvider: vi.fn(),
  createCreatorPayoutDestination: vi.fn(),
  checkRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/actor", () => ({ resolveCreatorContext: mocks.resolveCreatorContext }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: mocks.paystackProvider }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/payouts/creator-destinations", () => ({
  createCreatorPayoutDestination: mocks.createCreatorPayoutDestination,
}));

import { requestCreatorPayoutAction, saveCreatorPayoutDestinationAction } from "./actions";

const CREATOR = { creatorId: "creator-1", handle: "ama", country: "GH" as const };
const idle = { status: "idle" as const, values: {} };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveCreatorContext.mockResolvedValue(CREATOR);
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.paystackProvider.mockReturnValue({});
  mocks.createAdminClient.mockReturnValue({ rpc: vi.fn() });
  mocks.createCreatorPayoutDestination.mockResolvedValue({
    status: "active",
    destinationId: "dest-1",
    accountName: "AMA MENSAH",
  });
});

describe("requestCreatorPayoutAction", () => {
  it("asks the database, in minor units, with a fresh idempotency key", async () => {
    const result = await requestCreatorPayoutAction(idle, form({ amount: "60.50" }));

    expect(result.status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith("request_creator_payout", {
      p_amount_minor: 6050,
      p_idempotency_key: expect.stringMatching(/^creator-payout:creator-1:/),
    });
  });

  it("never passes a creator id: the RPC derives it from the session", async () => {
    await requestCreatorPayoutAction(idle, form({ amount: "60" }));
    const [, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(args)).not.toContain("p_creator_id");
  });

  it("shows the database's own refusal", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "That is more than your available balance." } });
    const result = await requestCreatorPayoutAction(idle, form({ amount: "900" }));
    expect(result).toMatchObject({ status: "error", message: "That is more than your available balance." });
  });

  it("refuses a missing amount without calling the database", async () => {
    const result = await requestCreatorPayoutAction(idle, form({ amount: "" }));
    expect(result.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses someone who is not a creator", async () => {
    mocks.resolveCreatorContext.mockResolvedValue(null);
    const result = await requestCreatorPayoutAction(idle, form({ amount: "60" }));
    expect(result.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("saveCreatorPayoutDestinationAction", () => {
  const details = { bankCode: "MTN", bankName: "MTN", type: "mobile_money", accountNumber: "0551234987" };

  it("saves against the signed-in creator in their own currency", async () => {
    const result = await saveCreatorPayoutDestinationAction(idle, form(details));

    expect(result.status).toBe("success");
    expect(result.message).toContain("AMA MENSAH");
    expect(mocks.createCreatorPayoutDestination).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId: "creator-1", currency: "GHS", type: "mobile_money" }),
      expect.anything(),
    );
  });

  it("never returns the account number, even when saving fails", async () => {
    mocks.createCreatorPayoutDestination.mockResolvedValue({ status: "error", message: "Not accepted." });
    const result = await saveCreatorPayoutDestinationAction(idle, form(details));
    expect(JSON.stringify(result)).not.toContain("0551234987");
  });

  it("is rate-limited, because every attempt reveals an account holder's name", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });
    const result = await saveCreatorPayoutDestinationAction(idle, form(details));
    expect(result.status).toBe("error");
    expect(mocks.createCreatorPayoutDestination).not.toHaveBeenCalled();
  });

  it("degrades to a plain refusal when Paystack is not configured", async () => {
    mocks.paystackProvider.mockImplementation(() => {
      throw new Error("Paystack is not configured.");
    });
    const result = await saveCreatorPayoutDestinationAction(idle, form(details));
    expect(result).toMatchObject({ status: "error", message: "Payouts are not available yet." });
  });
});
