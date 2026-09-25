import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/billing/resolve", () => ({
  getSellerPlan: mocks.getSellerPlan,
  planAllows: mocks.planAllows,
  upgradeMessage: (feature: string) => `Your current plan does not include ${feature}.`,
}));

import { createPromotion } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

/** Where the action redirected: the ?error= message, or "saved". */
async function outcome(action: Promise<unknown>): Promise<string> {
  await expect(action).rejects.toThrow(/NEXT_REDIRECT/);
  const url = String(mocks.redirect.mock.calls.at(-1)?.[0] ?? "");
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  return params.get("error") ?? (params.get("saved") ? "saved" : url);
}

function shopClient(insertResult: { error: unknown } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const shopSingle = vi.fn().mockResolvedValue({ data: { id: "shop-1" } });
  const from = vi.fn((table: string) =>
    table === "shops" ? { select: () => ({ eq: () => ({ single: shopSingle }) }) } : { insert },
  );
  mocks.createClient.mockResolvedValue({ from });
  return { from, insert };
}

const OWNER = { kind: "seller", sellerAccountId: "seller-1", status: "active", role: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.planAllows.mockReturnValue(true);
  mocks.resolveServerActor.mockResolvedValue(OWNER);
});

describe("createPromotion", () => {
  it("rejects a team member whose role lacks campaigns.manage, and says so", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...OWNER, role: "support" });
    const { from } = shopClient();

    expect(await outcome(createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" })))).toMatch(/role/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("tells a seller whose plan lacks promotions to upgrade, instead of doing nothing", async () => {
    mocks.planAllows.mockReturnValue(false);
    const { insert } = shopClient();

    expect(await outcome(createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" })))).toMatch(
      /does not include promotions/,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("explains an invalid discount", async () => {
    shopClient();
    expect(await outcome(createPromotion(formData({ kind: "percentage", value: "150", code: "BIG" })))).toMatch(/100/);
  });

  it("names a duplicate code", async () => {
    shopClient({ error: { code: "23505" } });
    expect(await outcome(createPromotion(formData({ kind: "fixed", value: "500", code: "save5" })))).toMatch(
      /already have a promotion with the code SAVE5/,
    );
  });

  it("allows the owner (no role set) to create a promotion", async () => {
    const { insert } = shopClient();

    expect(await outcome(createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" })))).toBe("saved");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ code: "SAVE5", kind: "fixed", value: 500 }));
  });
});
