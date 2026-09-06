import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  resolveServerActor: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import {
  saveShopAction,
  type OnboardingActionState,
} from "./actions";
import { mapPaymentActionResult } from "@/lib/payments/onboarding-result";

const initialState: OnboardingActionState = {
  status: "idle",
  values: {},
};

function formData(values: Record<string, string>) {
  const data = new FormData();

  Object.entries(values).forEach(([key, value]) => data.set(key, value));

  return data;
}

describe("onboarding actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller",
      authenticated: true,
      userId: "00000000-0000-0000-0000-000000000101",
      email: "seller@example.com",
      sellerAccountId: "00000000-0000-0000-0000-000000000201",
      country: "GH",
      status: "pending",
    });
  });

  it("saves a draft shop without requiring policy acceptance", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    // The address is assigned by the database, so the action reads it back —
    // without that the wizard would keep showing a placeholder on the very step
    // whose job is to tell the seller what their link is.
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { slug: "ama-market-k3fm" } }) }),
      }),
    }));
    mocks.createClient.mockResolvedValue({ from, rpc });

    const result = await saveShopAction(
      initialState,
      formData({
        displayName: "Ama Market",
        // A slug in the form is ignored: the RPC no longer takes one, so a
        // hand-crafted POST cannot put an address in the URL either.
        slug: "suma-ampim-st-23",
        legalName: "Ama Market Limited",
        registrationNumber: "",
      }),
    );

    expect(result).toMatchObject({
      status: "success",
      message: "Shop identity saved.",
      values: { slug: "ama-market-k3fm" },
    });
    expect(rpc).toHaveBeenCalledWith("save_onboarding_shop", {
      p_display_name: "Ama Market",
      p_legal_name: "Ama Market Limited",
      p_registration_number: "",
    });
  });

  it("maps exhausted activation retries to a distinct processing state", () => {
    expect(
      mapPaymentActionResult(
        {
          status: "reconciliation_required",
          message:
            "Payment setup is processing. It will be reconciled without creating another provider account.",
        },
      ),
    ).toEqual({
      status: "processing",
      message:
        "Payment setup is processing. It will be reconciled without creating another provider account.",
    });
  });
});
