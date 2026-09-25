import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdCampaign: vi.fn(),
  updateAdCampaign: vi.fn(),
  moveAdBudget: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/ads/service", () => ({
  createAdCampaign: mocks.createAdCampaign,
  updateAdCampaign: mocks.updateAdCampaign,
  moveAdBudget: mocks.moveAdBudget,
}));

import { changeCampaignAction, createCampaignAction, moveBudgetAction } from "./actions";

const OWNER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "owner@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

const KEY = "0b7d8c1e-2f3a-4b5c-8d6e-7f8091a2b3c4";
const CAMPAIGN = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PRODUCT_A = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const PRODUCT_B = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const IDLE = { status: "idle" as const };

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.moveAdBudget.mockResolvedValue({ ok: true, value: null });
  mocks.createAdCampaign.mockResolvedValue({ ok: true, value: CAMPAIGN });
  mocks.updateAdCampaign.mockResolvedValue({ ok: true, value: "paused" });
});

describe("moveBudgetAction", () => {
  it("moves money in minor units under the client's stable key", async () => {
    const result = await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "top_up", amount: "12.50" }));

    expect(mocks.moveAdBudget).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      direction: "top_up",
      amountMinor: 1250,
      idempotencyKey: `ads:${KEY}`,
    });
    expect(result.status).toBe("success");
    // A fresh key for the next, deliberate, move.
    expect(result.nextKey).toBeDefined();
    expect(result.nextKey).not.toBe(KEY);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/ads");
  });

  it("does not multiply XOF, which has no minor unit", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, country: "CI" as const });
    await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "withdraw", amount: "5000" }));
    expect(mocks.moveAdBudget).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000, direction: "withdraw" }));
  });

  // A manager can run campaigns but must not move the owner's withdrawable money.
  it("refuses every team role, including manager", async () => {
    for (const role of ["manager", "catalog", "fulfillment", "support", "analyst"] as const) {
      mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role });
      const result = await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "top_up", amount: "10" }));
      expect(result.status, role).toBe("error");
      expect(result.message, role).toContain("owner");
    }
    expect(mocks.moveAdBudget).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed idempotency key", async () => {
    const result = await moveBudgetAction(IDLE, form({ idempotencyKey: "abc", direction: "top_up", amount: "10" }));
    expect(result.status).toBe("error");
    expect(mocks.moveAdBudget).not.toHaveBeenCalled();
  });

  it("keeps the same key after a refusal so a retry cannot move money twice", async () => {
    mocks.moveAdBudget.mockResolvedValue({ ok: false, reason: "refused", message: "That is below the minimum top-up." });
    const result = await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "top_up", amount: "1" }));
    expect(result).toEqual({ status: "error", message: "That is below the minimum top-up.", nextKey: KEY });
  });

  it("refuses a zero amount and an unknown direction", async () => {
    expect((await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "top_up", amount: "0" }))).status).toBe("error");
    expect((await moveBudgetAction(IDLE, form({ idempotencyKey: KEY, direction: "steal", amount: "5" }))).status).toBe("error");
    expect(mocks.moveAdBudget).not.toHaveBeenCalled();
  });
});

describe("createCampaignAction", () => {
  const valid = { name: " Weekend push ", productId: [PRODUCT_A, PRODUCT_B], bid: "0.50", dailyBudget: "20" };

  it("creates a campaign with minor-unit bid and budget", async () => {
    const result = await createCampaignAction(IDLE, form(valid));
    expect(mocks.createAdCampaign).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      userId: "user-1",
      name: "Weekend push",
      productIds: [PRODUCT_A, PRODUCT_B],
      bidMinor: 50,
      dailyBudgetMinor: 2000,
    });
    expect(result.status).toBe("success");
  });

  it("lets a manager (campaigns.manage) create one", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "manager" as const });
    expect((await createCampaignAction(IDLE, form(valid))).status).toBe("success");
  });

  it("refuses roles without campaigns.manage", async () => {
    for (const role of ["catalog", "fulfillment", "support", "analyst"] as const) {
      mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role });
      expect((await createCampaignAction(IDLE, form(valid))).status, role).toBe("error");
    }
    expect(mocks.createAdCampaign).not.toHaveBeenCalled();
  });

  it("requires at least one product", async () => {
    const result = await createCampaignAction(IDLE, form({ name: "x", bid: "1", dailyBudget: "5" }));
    expect(result.message).toMatch(/at least one product/);
    expect(mocks.createAdCampaign).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal", async () => {
    mocks.createAdCampaign.mockResolvedValue({
      ok: false,
      reason: "refused",
      message: "The bid per click is outside the allowed range.",
    });
    const result = await createCampaignAction(IDLE, form(valid));
    expect(result).toEqual({ status: "error", message: "The bid per click is outside the allowed range." });
  });
});

describe("changeCampaignAction", () => {
  it("pauses a campaign", async () => {
    const result = await changeCampaignAction(IDLE, form({ campaignId: CAMPAIGN, action: "pause" }));
    expect(mocks.updateAdCampaign).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      campaignId: CAMPAIGN,
      change: { action: "pause" },
    });
    expect(result).toEqual({ status: "success", message: "Campaign paused." });
  });

  it("says when a resumed campaign is still short of budget", async () => {
    mocks.updateAdCampaign.mockResolvedValue({ ok: true, value: "out_of_funds" });
    const result = await changeCampaignAction(IDLE, form({ campaignId: CAMPAIGN, action: "resume" }));
    expect(result.message).toMatch(/budget covers a click/);
  });

  it("refuses an analyst and an unknown action", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "analyst" as const });
    expect((await changeCampaignAction(IDLE, form({ campaignId: CAMPAIGN, action: "end" }))).status).toBe("error");
    mocks.resolveServerActor.mockResolvedValue(OWNER);
    expect((await changeCampaignAction(IDLE, form({ campaignId: CAMPAIGN, action: "boost" }))).status).toBe("error");
    expect(mocks.updateAdCampaign).not.toHaveBeenCalled();
  });
});
