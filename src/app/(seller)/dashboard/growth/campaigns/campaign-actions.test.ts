import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { createCampaignRecord, updateCampaignRecord } from "./campaign-actions";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Server actions signal by redirecting, so both success and refusal throw. */
async function redirectFrom(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.startsWith("REDIRECT:") ? message.slice("REDIRECT:".length) : "";
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.insert.mockReturnValue({
    select: () => ({ single: async () => ({ data: { id: "camp-1" }, error: null }) }),
  });
  mocks.update.mockReturnValue({ eq: async () => ({ error: null }) });
  mocks.createClient.mockResolvedValue({
    from: (table: string) =>
      table === "shops"
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "shop-1" } }) }) }) }
        : { insert: mocks.insert, update: mocks.update },
  });
});

describe("createCampaignRecord", () => {
  it("stores the campaign and opens it", async () => {
    const url = await redirectFrom(() =>
      createCampaignRecord(
        form({
          name: "December drop",
          objective: "Sell 40 wrappers",
          status: "active",
          starts_at: "2026-12-01",
          ends_at: "2026-12-24",
          budget: "250",
          spend: "80.50",
        }),
      ),
    );

    expect(url).toBe("/dashboard/growth/campaigns/camp-1");
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "December drop",
        objective: "Sell 40 wrappers",
        status: "active",
        starts_at: "2026-12-01",
        ends_at: "2026-12-24",
        seller_account_id: "seller-1",
        shop_id: "shop-1",
      }),
    );
  });

  it("stores money in minor units, including the awkward halves", async () => {
    await redirectFrom(() =>
      createCampaignRecord(form({ name: "X", status: "draft", budget: "250", spend: "80.50" })),
    );

    const row = mocks.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.budget_minor).toBe(25_000);
    expect(row.spend_minor).toBe(8_050);
  });

  it("treats a blank budget as unset, but a blank spend as nothing spent", async () => {
    await redirectFrom(() => createCampaignRecord(form({ name: "X", status: "draft" })));

    const row = mocks.insert.mock.calls[0]![0] as Record<string, unknown>;
    // Null and zero are different claims: "I never set one" vs "I spent none".
    expect(row.budget_minor).toBeNull();
    expect(row.spend_minor).toBe(0);
  });

  it("refuses an unnamed campaign, out loud", async () => {
    const url = await redirectFrom(() => createCampaignRecord(form({ name: "  ", status: "draft" })));

    expect(url).toContain("error=");
    expect(decodeURIComponent(url)).toContain("name");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses dates that run backwards before the database has to", async () => {
    const url = await redirectFrom(() =>
      createCampaignRecord(
        form({ name: "X", status: "draft", starts_at: "2026-12-24", ends_at: "2026-12-01" }),
      ),
    );

    // The CHECK would catch it, but as "could not be saved" rather than
    // something the seller can act on.
    expect(decodeURIComponent(url)).toContain("end date");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses a status outside the enum", async () => {
    const url = await redirectFrom(() =>
      createCampaignRecord(form({ name: "X", status: "launched" })),
    );

    expect(url).toContain("error=");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses a role that cannot manage campaigns", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "fulfillment" as const });

    const url = await redirectFrom(() => createCampaignRecord(form({ name: "X", status: "draft" })));

    expect(url).toContain("error=");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses a seller with no shop", async () => {
    mocks.createClient.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
    });

    const url = await redirectFrom(() => createCampaignRecord(form({ name: "X", status: "draft" })));

    expect(decodeURIComponent(url)).toContain("shop");
  });
});

describe("updateCampaignRecord", () => {
  it("saves changes and returns to the campaign", async () => {
    const url = await redirectFrom(() =>
      updateCampaignRecord(form({ campaignId: "camp-1", name: "Renamed", status: "paused" })),
    );

    expect(url).toBe("/dashboard/growth/campaigns/camp-1?saved=1");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed", status: "paused" }),
    );
  });

  it("reports a refusal against the campaign it came from", async () => {
    const url = await redirectFrom(() =>
      updateCampaignRecord(form({ campaignId: "camp-1", name: "", status: "draft" })),
    );

    expect(url).toContain("/dashboard/growth/campaigns/camp-1?error=");
  });
});
