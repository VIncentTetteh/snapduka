import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
// redirect() throws in Next; reproducing that lets a test assert the refusal
// was spoken, not only that nothing was written.
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, planAllows: mocks.planAllows }));

vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));

import { addCustomDomain, verifyCustomDomain } from "./actions";

/** The ?error= message a refused action redirected with. */
async function refusal(action: Promise<unknown>): Promise<string | null> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("NEXT_REDIRECT:")) throw error;
    const url = String(mocks.redirect.mock.calls.at(-1)?.[0] ?? "");
    return new URLSearchParams(url.split("?")[1] ?? "").get("error");
  }
  return null;
}

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.planAllows.mockReturnValue(true);
  mocks.isFeatureEnabled.mockResolvedValue(true);
});

describe("custom domains while they are not connected to hosting", () => {
  beforeEach(() => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "owner",
    });
  });

  it.each([
    ["adding", () => addCustomDomain(formData({ hostname: "shop.example.com" }))],
    ["verifying", () => verifyCustomDomain(formData({ domainId: "d-1" }))],
  ])("refuses %s a domain, and says so", async (_label, run) => {
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    expect(await refusal(run())).toMatch(/not available yet/i);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("custom_domains", { sellerAccountId: "seller-1" });
  });
});

describe("addCustomDomain", () => {
  it("rejects a team member whose role lacks settings.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "analyst",
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    let message: string | null = null;
    try {
      await addCustomDomain(formData({ hostname: "shop.example.com" }));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("NEXT_REDIRECT:")) throw error;
      const url = String(mocks.redirect.mock.calls.at(-1)?.[0] ?? "");
      message = new URLSearchParams(url.split("?")[1] ?? "").get("error");
    }

    expect(from).not.toHaveBeenCalled();
    // Refusing silently is the bug: the seller has to learn it is their role.
    expect(message).toMatch(/role/i);
  });
});
