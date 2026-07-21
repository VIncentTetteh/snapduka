import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, planAllows: mocks.planAllows }));

import { createPromotion } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.planAllows.mockReturnValue(true);
});

describe("createPromotion", () => {
  it("rejects a team member whose role lacks campaigns.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "support",
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    await createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" }));

    expect(from).not.toHaveBeenCalled();
  });

  it("allows the owner (no role set) to create a promotion", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: undefined,
    });
    const insert = vi.fn().mockResolvedValue({});
    const shopSingle = vi.fn().mockResolvedValue({ data: { id: "shop-1" } });
    const shopEq = vi.fn().mockReturnValue({ single: shopSingle });
    const shopSelect = vi.fn().mockReturnValue({ eq: shopEq });
    const from = vi.fn((table: string) => (table === "shops" ? { select: shopSelect } : { insert }));
    mocks.createClient.mockResolvedValue({ from });

    await createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" }));

    expect(insert).toHaveBeenCalled();
  });
});
