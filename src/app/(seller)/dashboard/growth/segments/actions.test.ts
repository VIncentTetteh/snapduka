import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  withinPlanLimit: vi.fn(),
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
  withinPlanLimit: mocks.withinPlanLimit,
  planLimit: () => 3,
}));

import { createSegment } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

async function outcome(action: Promise<unknown>): Promise<string> {
  await expect(action).rejects.toThrow(/NEXT_REDIRECT/);
  const url = String(mocks.redirect.mock.calls.at(-1)?.[0] ?? "");
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  return params.get("error") ?? (params.get("saved") ? "saved" : url);
}

function client() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select: () => ({ eq: async () => ({ count: 3 }) }), insert }));
  mocks.createClient.mockResolvedValue({ from });
  return { insert };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue({ kind: "seller", sellerAccountId: "seller-1", status: "active" });
  mocks.getSellerPlan.mockResolvedValue({ planName: "Free" });
});

describe("createSegment", () => {
  it("names the plan limit instead of silently doing nothing", async () => {
    mocks.withinPlanLimit.mockReturnValue(false);
    const { insert } = client();

    expect(await outcome(createSegment(formData({ name: "Repeat buyers" })))).toMatch(/Free plan includes 3 segments/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("asks for a name", async () => {
    client();
    expect(await outcome(createSegment(formData({ name: " " })))).toMatch(/name/i);
  });

  it("creates the segment within the limit", async () => {
    mocks.withinPlanLimit.mockReturnValue(true);
    const { insert } = client();

    expect(await outcome(createSegment(formData({ name: "Repeat buyers", minimumOrders: "2" })))).toBe("saved");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Repeat buyers", rules: expect.objectContaining({ minimumOrders: 2 }) }),
    );
  });
});
