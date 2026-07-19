import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  withinPlanLimit: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
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

    await createBroadcast(formData({ channel: "email", body: "Hello", segmentId: "not-mine-segment" }));

    expect(insert).not.toHaveBeenCalled();
  });
});
