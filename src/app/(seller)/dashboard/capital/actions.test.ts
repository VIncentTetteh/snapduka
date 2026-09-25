import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  acceptFinancingOffer: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/financing/service", () => ({ acceptFinancingOffer: mocks.acceptFinancingOffer }));

import { acceptOfferAction } from "./actions";

const OWNER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "owner@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

const TEAM_ROLES = ["manager", "catalog", "fulfillment", "support", "analyst"] as const;
const OFFER_ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function acceptForm(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    offerId: OFFER_ID,
    expectedTotalMinor: "265000",
    termsVersion: "v1",
    confirm: "yes",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== null) data.set(key, value);
  return data;
}

const IDLE = { status: "idle" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.acceptFinancingOffer.mockResolvedValue({ ok: true, advanceId: "adv-1", state: "disbursed" });
});

describe("acceptOfferAction", () => {
  // A team member carries the owner's sellerAccountId; the service writes with
  // the service-role client, so this check is the only thing between a manager
  // and a debt in the owner's name.
  it("refuses every team role, including manager", async () => {
    for (const role of TEAM_ROLES) {
      mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role });
      const result = await acceptOfferAction(IDLE, acceptForm());
      expect(result.status, role).toBe("error");
      expect(result.message, role).toContain("owner");
    }
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not a seller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });
    const result = await acceptOfferAction(IDLE, acceptForm());
    expect(result.status).toBe("error");
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("refuses without the confirmation tick", async () => {
    const missing = await acceptOfferAction(IDLE, acceptForm({ confirm: null }));
    const wrong = await acceptOfferAction(IDLE, acceptForm({ confirm: "on" }));
    expect(missing.status).toBe("error");
    expect(missing.message).toMatch(/accept the terms/);
    expect(wrong.status).toBe("error");
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("refuses a malformed offer id or total", async () => {
    expect((await acceptOfferAction(IDLE, acceptForm({ offerId: "nope" }))).status).toBe("error");
    expect((await acceptOfferAction(IDLE, acceptForm({ expectedTotalMinor: "12.5" }))).status).toBe("error");
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("passes the exact values the seller saw and revalidates", async () => {
    const result = await acceptOfferAction(IDLE, acceptForm());

    expect(mocks.acceptFinancingOffer).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      userId: "user-1",
      offerId: OFFER_ID,
      expectedTotalMinor: 265000,
      termsVersion: "v1",
    });
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/in your SnapDuka balance/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/capital");
  });

  it("says when the partner has not funded it yet", async () => {
    mocks.acceptFinancingOffer.mockResolvedValue({ ok: true, advanceId: "adv-1", state: "awaiting_partner" });
    const result = await acceptOfferAction(IDLE, acceptForm());
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/waiting for our lending partner/);
  });

  it("surfaces the service's refusal verbatim", async () => {
    mocks.acceptFinancingOffer.mockResolvedValue({
      ok: false,
      reason: "refused",
      message: "This offer has changed. Reload to see the new terms.",
    });
    const result = await acceptOfferAction(IDLE, acceptForm());
    expect(result).toEqual({ status: "error", message: "This offer has changed. Reload to see the new terms." });
  });
});
