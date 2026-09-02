import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  disableSubscription: vi.fn(),
  enableSubscription: vi.fn(),
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
    enableSubscription: mocks.enableSubscription,
    createPlan: mocks.createPlan,
    initializeSubscription: mocks.initializeSubscription,
  }),
}));

import { cancelSubscription, changePlan, keepCurrentPlan } from "./actions";

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

  /**
   * The regression this suite exists for. changePlan used to upsert the seller
   * straight onto the target in state 'trialing' — which grants nothing — and
   * disable their Paystack subscription, both BEFORE payment. A seller who
   * clicked Upgrade and abandoned the checkout lost the plan they were paying
   * for. Reproduced on the live demo account before the fix.
   */
  it("upgrading Growth to Scale parks the target and leaves the paid plan running", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-scale", name: "Scale", version: 2 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-2", amount_minor: 15000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_scale" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({
      from: () => ({ upsert, update, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }),
    });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/y", reference: "ref-2" });

    await expect(changePlan(formData({ planCode: "scale", interval: "monthly" }))).rejects.toThrow("NEXT_REDIRECT");

    // The live row is never replaced, so entitlements survive an abandoned checkout.
    expect(upsert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_change_type: "upgrade",
        pending_plan_id: "plan-scale",
        pending_plan_version: 2,
        pending_price_id: "price-2",
      }),
    );
    // And their renewal is not cancelled for a plan they have not bought yet.
    expect(mocks.disableSubscription).not.toHaveBeenCalled();
  });

  it("still upserts a trialing row when there is nothing entitled to protect", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const expired = {
      id: "sub-1", state: "expired", grace_ends_at: null, current_period_end: "2026-01-01T00:00:00Z",
      provider_subscription_code: null, provider_email_token: null,
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: expired });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", name: "Growth", version: 2 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({
      from: () => ({ upsert, update, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }),
    });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/z", reference: "ref-3" });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-growth", state: "trialing" }),
      { onConflict: "seller_account_id" },
    );
  });

  it("clears the parked upgrade when Paystack cannot start the checkout", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-scale", name: "Scale", version: 2 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-2", amount_minor: 15000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_scale" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const eqSecond = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: eqSecond })) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update, upsert: vi.fn(), delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.initializeSubscription.mockRejectedValue(new Error("paystack down"));

    await expect(changePlan(formData({ planCode: "scale", interval: "monthly" }))).rejects.toThrow("NEXT_REDIRECT");

    // A phantom pending upgrade would nag the seller forever on the billing page.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pending_change_type: null, pending_plan_id: null }),
    );
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

  /**
   * Monthly -> yearly is more money committed, so it is charged now like any
   * other upgrade. Previously "You are already on this plan" blocked it and
   * there was no way to reach yearly billing at all.
   */
  it("switching monthly to yearly on the same plan is charged as an upgrade", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", name: "Growth", version: 2 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-growth-yearly", amount_minor: 60000, currency: "GHS", interval: "yearly", provider_plan_code: "PLN_growth_y" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update, upsert: vi.fn(), delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/yr", reference: "ref-y" });

    await expect(changePlan(formData({ planCode: "growth", interval: "yearly" }))).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.paystack.com/yr",
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pending_change_type: "upgrade", pending_price_id: "price-growth-yearly" }),
    );
    // Still an upgrade, so the paid monthly plan keeps running until it clears.
    expect(mocks.disableSubscription).not.toHaveBeenCalled();
  });

  /**
   * Yearly -> monthly is less commitment, so it waits for the paid year to
   * finish rather than refunding it.
   */
  it("switching yearly to monthly on the same plan is scheduled, not charged", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2027-01-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "yearly" },
    };
    const priceQuery = queryMock({ data: { id: "price-growth-monthly" } });
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", version: 2 } });
      if (table === "plan_prices") return priceQuery;
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
    mocks.disableSubscription.mockResolvedValue(undefined);

    await changePlan(formData({ planCode: "growth", interval: "monthly" }));

    expect(mocks.initializeSubscription).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pending_change_type: "downgrade", pending_price_id: "price-growth-monthly" }),
    );
    // The scheduled price must be the interval the seller asked for, not the
    // one they are currently billed on.
    expect(priceQuery.eq).toHaveBeenCalledWith("interval", "monthly");
  });

  it("a tier downgrade keeps the seller's existing interval", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2027-01-01T00:00:00Z",
      provider_subscription_code: null, provider_email_token: null,
      plans: { code: "scale" }, plan_prices: { interval: "yearly" },
    };
    const priceQuery = queryMock({ data: { id: "price-growth-yearly" } });
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", version: 2 } });
      if (table === "plan_prices") return priceQuery;
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }) });

    // The UI sends no interval for a tier downgrade, so it defaults to monthly
    // — which must NOT silently move a yearly seller onto monthly pricing.
    await changePlan(formData({ planCode: "growth" }));

    expect(priceQuery.eq).toHaveBeenCalledWith("interval", "yearly");
  });

  it("a tier downgrade uses an explicitly selected interval", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2027-01-01T00:00:00Z",
      provider_subscription_code: null, provider_email_token: null,
      plans: { code: "scale" }, plan_prices: { interval: "yearly" },
    };
    const priceQuery = queryMock({ data: { id: "price-growth-monthly" } });
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", version: 2 } });
      if (table === "plan_prices") return priceQuery;
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }) });

    await changePlan(formData({ planCode: "growth", interval: "monthly" }));

    expect(priceQuery.eq).toHaveBeenCalledWith("interval", "monthly");
  });

  it("already on this plan AND interval is rejected", async () => {
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

// Regression: ISSUE-011 — every real merchant was `pending` (verification not
// finished), and both billing actions opened with a silent `return` unless the
// account was exactly `active`. Clicking Upgrade did nothing: no charge, no
// redirect, no error. Confirmed against production, where 4 of 5 sellers were
// pending and therefore could not pay at all.
// Found by /qa on 2026-09-01
describe("changePlan account guard", () => {
  const base = { data: null };

  function wireMinimalClient() {
    mocks.createClient.mockResolvedValue({ from: () => queryMock(base) });
    mocks.createAdminClient.mockReturnValue({ from: () => queryMock(base) });
  }

  it("lets a pending seller subscribe — verification gates payouts, not paying us", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER_ACTOR, status: "pending" });
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: null });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", name: "Growth", version: 1 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_g" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    mocks.createAdminClient.mockReturnValue({
      from: () => ({ upsert: vi.fn().mockResolvedValue({ error: null }), delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }),
    });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/p", reference: "r" });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.paystack.com/p",
    );
    expect(mocks.initializeSubscription).toHaveBeenCalled();
  });

  it("tells a suspended seller why instead of doing nothing", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER_ACTOR, status: "suspended" });
    wireMinimalClient();

    await expect(changePlan(formData({ planCode: "growth" }))).rejects.toThrow(/suspended/i);
    expect(mocks.initializeSubscription).not.toHaveBeenCalled();
  });

  it("tells a closed account why instead of doing nothing", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER_ACTOR, status: "closed" });
    wireMinimalClient();

    await expect(changePlan(formData({ planCode: "growth" }))).rejects.toThrow(/closed/i);
  });

  it("refuses a team member out loud rather than silently", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER_ACTOR, role: "manager" });
    wireMinimalClient();

    await expect(changePlan(formData({ planCode: "growth" }))).rejects.toThrow(/owner/i);
  });
});

// Regression: ISSUE-007 — a scheduled downgrade or cancellation was a one-way
// door. The cancel control was hidden once anything was pending, and picking
// the current plan again was rejected as "already on this plan", so sellers
// were dropped at period end with no way to stop it.
describe("keepCurrentPlan", () => {
  it("restarts the Paystack renewal BEFORE clearing the pending change", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const order: string[] = [];
    mocks.enableSubscription.mockImplementation(async () => { order.push("paystack"); });
    const update = vi.fn(() => { order.push("db"); return { eq: vi.fn().mockResolvedValue({ error: null }) }; });
    mocks.createClient.mockResolvedValue({
      from: () => queryMock({
        data: {
          id: "sub-1", pending_change_type: "downgrade",
          provider_subscription_code: "SUB_x", provider_email_token: "tok_x",
        },
      }),
    });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });

    await keepCurrentPlan();

    expect(mocks.enableSubscription).toHaveBeenCalledWith("SUB_x", "tok_x");
    expect(order).toEqual(["paystack", "db"]);
  });

  it("leaves the pending change in place when Paystack refuses", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.enableSubscription.mockRejectedValue(new Error("paystack down"));
    const update = vi.fn(() => ({ eq: vi.fn() }));
    mocks.createClient.mockResolvedValue({
      from: () => queryMock({
        data: {
          id: "sub-1", pending_change_type: "cancel",
          provider_subscription_code: "SUB_x", provider_email_token: "tok_x",
        },
      }),
    });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });

    // Clearing it anyway would leave the row claiming an active plan that
    // silently never renews — worse than the scheduled change it undid.
    await expect(keepCurrentPlan()).rejects.toThrow(/renewal/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses when there is no scheduled change to call off", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.createClient.mockResolvedValue({
      from: () => queryMock({ data: { id: "sub-1", pending_change_type: null } }),
    });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update: vi.fn() }) });

    await expect(keepCurrentPlan()).rejects.toThrow(/scheduled/i);
  });
});
