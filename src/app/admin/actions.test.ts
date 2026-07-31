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
});
