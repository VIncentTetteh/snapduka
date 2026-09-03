import { beforeEach, describe, expect, it, vi } from "vitest";

// Reached transitively through @/lib/audit/write; the real server-only package
// throws unconditionally outside webpack.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { reviewPayoutAction } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("reviewPayoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login instead of silently no-oping when the session is no longer an operator", async () => {
    // Reproduces the bug: an operator session that expired mid-page (e.g.
    // Supabase access token TTL) resolves to a non-operator actor on the
    // next mutating request. Approving a payout must surface this instead
    // of quietly doing nothing.
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });
    const admin = { from: vi.fn(), rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(admin);

    await expect(
      reviewPayoutAction(
        formData({ payoutId: "p1", decision: "approved", reason: "Looks good" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?next=/admin/payouts");

    expect(admin.from).not.toHaveBeenCalled();
  });

  it("approves a requested payout for a valid operator", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "operator",
      authenticated: true,
      userId: "00000000-0000-0000-0000-000000000901",
      email: "operator@example.com",
      role: "operator",
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "p1",
        status: "requested",
        seller_account_id: "seller-1",
        amount_minor: 10000,
        currency: "GHS",
      },
    });
    const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqSelect });

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn().mockReturnValue({ select, update });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ from, rpc });

    await reviewPayoutAction(
      formData({ payoutId: "p1", decision: "approved", reason: "Looks good" }),
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", review_reason: "Looks good" }),
    );
    expect(rpc).toHaveBeenCalledWith("write_audit_event", expect.objectContaining({
      p_action: "payout_approved",
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payouts");
  });

  // The remaining guards refused with a bare `return`: the queue re-rendered
  // unchanged and the operator's natural read was that the decision went
  // through. On the one action that releases money that is not acceptable, and
  // it is the same defect that made billing silently unpayable (ISSUE-011).
  // Found by /qa on 2026-09-03

  function operatorSession() {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "operator",
      authenticated: true,
      userId: "00000000-0000-0000-0000-000000000901",
      email: "operator@example.com",
      role: "operator",
    });
  }

  function adminReturning(payout: Record<string, unknown> | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: payout });
    const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const client = { from: vi.fn().mockReturnValue({ select, update }), rpc: vi.fn().mockResolvedValue({ error: null }) };
    mocks.createAdminClient.mockReturnValue(client);
    return { client, update };
  }

  it("says why when the operational reason is missing", async () => {
    operatorSession();
    const { update } = adminReturning(null);

    await expect(
      reviewPayoutAction(formData({ payoutId: "p1", decision: "approved", reason: "  " })),
    ).rejects.toThrow(/operational%20reason/);

    expect(update).not.toHaveBeenCalled();
  });

  it("says why when the payout has already been decided by someone else", async () => {
    // Two operators on the queue at once is the ordinary case, not the edge.
    operatorSession();
    const { update } = adminReturning({
      id: "p1",
      status: "rejected",
      seller_account_id: "seller-1",
      amount_minor: 10000,
      currency: "GHS",
    });

    await expect(
      reviewPayoutAction(formData({ payoutId: "p1", decision: "approved", reason: "Verified" })),
    ).rejects.toThrow(/already%20rejected/);

    // Critically: the decision is refused, not silently applied over the top.
    expect(update).not.toHaveBeenCalled();
  });

  it("says why when the payout no longer exists", async () => {
    operatorSession();
    const { update } = adminReturning(null);

    await expect(
      reviewPayoutAction(formData({ payoutId: "gone", decision: "approved", reason: "Verified" })),
    ).rejects.toThrow(/no%20longer%20exists/);

    expect(update).not.toHaveBeenCalled();
  });

  it("still refuses to let an operator mark a payout paid by hand", async () => {
    // Only apply_paystack_transfer_event may set 'paid': marking it by hand
    // would debit the seller with no transfer in existence and the books
    // claiming settlement.
    operatorSession();
    const { update } = adminReturning({
      id: "p1",
      status: "approved",
      seller_account_id: "seller-1",
      amount_minor: 10000,
      currency: "GHS",
    });

    await expect(
      reviewPayoutAction(formData({ payoutId: "p1", decision: "paid", reason: "Bank confirmed" })),
    ).rejects.toThrow(/approve%20or%20reject/);

    expect(update).not.toHaveBeenCalled();
  });
});
