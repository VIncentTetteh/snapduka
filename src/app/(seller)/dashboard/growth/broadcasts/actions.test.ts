import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  withinPlanLimit: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
// redirect() throws in Next; reproducing it lets a refusal be asserted as
// spoken rather than merely absent.
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, withinPlanLimit: mocks.withinPlanLimit }));

import { createBroadcast } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const SELLER_ACTOR = {
  kind: "seller" as const, authenticated: true, userId: "u1", email: "seller@example.com",
  sellerAccountId: "seller-1", country: "GH" as const, status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.withinPlanLimit.mockReturnValue(true);
});

describe("createBroadcast", () => {
  it("does not insert a broadcast when the referenced segment does not belong to the seller", async () => {
    const segmentMaybeSingle = vi.fn().mockResolvedValue({ data: null });
    const segmentEq2 = vi.fn().mockReturnValue({ maybeSingle: segmentMaybeSingle });
    const segmentEq1 = vi.fn().mockReturnValue({ eq: segmentEq2 });
    const segmentSelect = vi.fn().mockReturnValue({ eq: segmentEq1 });
    const insert = vi.fn().mockResolvedValue({});
    const usageCount = vi.fn().mockResolvedValue({ count: 0 });
    const from = vi.fn((table: string) => {
      if (table === "customer_segments") return { select: segmentSelect };
      if (table === "marketing_broadcasts") return { select: () => ({ eq: () => ({ gte: usageCount }) }), insert };
      return {};
    });
    mocks.createClient.mockResolvedValue({ from });

    await expect(
      createBroadcast(formData({ channel: "email", body: "Hello", segmentId: "not-mine-segment" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(insert).not.toHaveBeenCalled();
    expect(decodeURIComponent(String(mocks.redirect.mock.calls.at(-1)?.[0]))).toMatch(
      /customer group/i,
    );
  });
});
