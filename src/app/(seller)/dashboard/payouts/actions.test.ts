import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  paystackProvider: vi.fn(),
  createPayoutDestination: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: mocks.paystackProvider }));
vi.mock("@/lib/payouts/destinations", () => ({
  createPayoutDestination: mocks.createPayoutDestination,
}));

import { requestPayoutAction, savePayoutDestinationAction } from "./actions";

/**
 * Where the money goes is owner-only.
 *
 * `resolveServerActor` hands a team member `kind: "seller"` carrying the
 * **owner's** sellerAccountId, so `kind` says nothing about who is calling.
 * `savePayoutDestinationAction` then runs through the service-role client, and
 * `reserve_payout_destination` is granted to `service_role` alone and trusts the
 * seller id it is passed — so RLS is not behind this and the action's own check
 * is the entire boundary. Without it an analyst could point the shop's
 * withdrawals at their own bank account.
 */

const OWNER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "owner@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

/** Every team role carries the owner's sellerAccountId, plus a `role`. */
const TEAM_ROLES = ["manager", "catalog", "fulfillment", "support", "analyst"] as const;

function destinationForm() {
  const data = new FormData();
  data.set("bankCode", "058");
  data.set("bankName", "GTBank");
  data.set("type", "bank");
  data.set("accountNumber", "0123456789");
  return data;
}

function amountForm(amount = "50") {
  const data = new FormData();
  data.set("amount", amount);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.createPayoutDestination.mockResolvedValue({ status: "success", accountName: "A Seller" });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { legal_name: "A Seller" } }) }),
      }),
    }),
  });
  mocks.createAdminClient.mockReturnValue({ rpc: vi.fn() });
});

describe("savePayoutDestinationAction", () => {
  it("lets the account owner set where withdrawals go", async () => {
    const result = await savePayoutDestinationAction({ status: "idle", values: {} }, destinationForm());

    expect(result.status).toBe("success");
    expect(mocks.createPayoutDestination).toHaveBeenCalled();
  });

  // The finding: every one of these resolves as kind:"seller" with the owner's
  // account id, and the service-role client means RLS cannot refuse them.
  it("refuses every team role, including manager", async () => {
    for (const role of TEAM_ROLES) {
      mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role });

      const result = await savePayoutDestinationAction({ status: "idle", values: {} }, destinationForm());

      expect(result.status, role).toBe("error");
      expect(result.message, role).toContain("owner");
    }
    expect(mocks.createPayoutDestination).not.toHaveBeenCalled();
  });

  it("never echoes the account number back into the rendered state", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "analyst" as const });

    const result = await savePayoutDestinationAction({ status: "idle", values: {} }, destinationForm());

    expect(JSON.stringify(result.values)).not.toContain("0123456789");
  });

  it("still refuses a suspended owner", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, status: "suspended" as const });

    const result = await savePayoutDestinationAction({ status: "idle", values: {} }, destinationForm());

    expect(result.status).toBe("error");
    expect(mocks.createPayoutDestination).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not a seller at all", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const result = await savePayoutDestinationAction({ status: "idle", values: {} }, destinationForm());

    expect(result.status).toBe("error");
    expect(mocks.createPayoutDestination).not.toHaveBeenCalled();
  });
});

describe("requestPayoutAction", () => {
  it("lets the owner withdraw", async () => {
    const result = await requestPayoutAction({ status: "idle", values: {} }, amountForm("50"));

    expect(result.status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_seller_payout",
      expect.objectContaining({ p_amount_minor: 5000 }),
    );
  });

  // request_seller_payout derives the seller itself and would refuse anyway,
  // but it refuses with a database error rather than a sentence.
  it("refuses a team member with an explanation rather than a database error", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "manager" as const });

    const result = await requestPayoutAction({ status: "idle", values: {} }, amountForm("50"));

    expect(result.status).toBe("error");
    expect(result.message).toContain("owner");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("converts XOF without a minor unit", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, country: "CI" as const });

    await requestPayoutAction({ status: "idle", values: {} }, amountForm("3000"));

    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_seller_payout",
      expect.objectContaining({ p_amount_minor: 3000 }),
    );
  });
});
