import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  disableSubscription: vi.fn(),
  createPlan: vi.fn(),
  initializeSubscription: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({
    disableSubscription: mocks.disableSubscription,
    createPlan: mocks.createPlan,
    initializeSubscription: mocks.initializeSubscription,
  }),
}));

import { cancelSubscription, changePlan } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const SELLER_ACTOR = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

/** Builds a chainable query-builder mock: every method returns `this`,
 * and the given terminal result resolves whichever method is called last. */
function queryMock(result: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ["select", "eq", "in", "not", "lte"].forEach((method) => {
    chain[method] = vi.fn(self);
  });
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.upsert = vi.fn().mockReturnValue({ ...chain, then: undefined });
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
});

describe("changePlan", () => {
  it("upgrades Free to Growth: no disableSubscription call, starts checkout", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: null });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", name: "Growth", version: 1 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/x", reference: "ref-1" });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.paystack.com/x",
    );

    expect(mocks.disableSubscription).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-growth", state: "trialing", pending_change_type: null }),
      { onConflict: "seller_account_id" },
    );
  });

  it("upgrading Growth to Scale disables the old subscription before starting the new checkout", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-scale", name: "Scale", version: 1 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-2", amount_minor: 15000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_scale" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.disableSubscription.mockResolvedValue(undefined);
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/y", reference: "ref-2" });

    await expect(changePlan(formData({ planCode: "scale", interval: "monthly" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ plan_id: "plan-scale" }), { onConflict: "seller_account_id" });
  });

  it("downgrading Scale to Growth schedules the change and leaves state/plan untouched", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "scale" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", version: 1 } });
      if (table === "plan_prices") return queryMock({ data: { id: "price-growth-monthly" } });
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
    mocks.disableSubscription.mockResolvedValue(undefined);

    await changePlan(formData({ planCode: "growth", interval: "monthly" }));

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(mocks.initializeSubscription).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_change_type: "downgrade",
        pending_plan_id: "plan-growth",
        pending_price_id: "price-growth-monthly",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/settings/billing");
  });

  it("already on this plan is rejected", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: null, provider_email_token: null,
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: existing }) });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/billing?error=You%20are%20already%20on%20this%20plan.",
    );
  });
});

describe("cancelSubscription", () => {
  it("schedules a cancel-to-Free the same way changePlan(planCode=free) does", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: existing }) });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
    mocks.disableSubscription.mockResolvedValue(undefined);

    await cancelSubscription();

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ pending_change_type: "cancel" }));
  });

  it("nothing to cancel on Free is rejected", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: null }) });

    await expect(cancelSubscription()).rejects.toThrow("NEXT_REDIRECT");
  });
});
