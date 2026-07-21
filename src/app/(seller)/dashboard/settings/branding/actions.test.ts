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

import { addCustomDomain } from "./actions";

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

describe("addCustomDomain", () => {
  it("rejects a team member whose role lacks settings.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "analyst",
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    await addCustomDomain(formData({ hostname: "shop.example.com" }));

    expect(from).not.toHaveBeenCalled();
  });
});
