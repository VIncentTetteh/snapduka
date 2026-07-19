import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  createAdminClient: vi.fn(),
  createPlan: vi.fn(),
  createSubscriptionForAuthorization: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({
    createPlan: mocks.createPlan,
    createSubscriptionForAuthorization: mocks.createSubscriptionForAuthorization,
  }),
}));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/billing/apply-plan-changes", { method: "POST" });
}

/** A minimal chainable Supabase query-builder mock, table-keyed. */
function adminMock(tables: Record<string, { select?: unknown; update?: (payload: unknown) => unknown }>) {
  return {
    from: (table: string) => {
      const t = tables[table] ?? {};
      return {
        select: () => ({
          not: () => ({ lte: () => Promise.resolve({ data: t.select }) }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: t.select }) }),
        }),
        update: (payload: unknown) => ({
          eq: () => ({ eq: () => Promise.resolve({ data: t.update ? t.update(payload) : null }) }),
        }),
      };
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/internal/billing/apply-plan-changes", () => {
  it("rejects unauthorized requests", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("applies a due cancel: sets state to cancelled and clears pending fields", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "cancel", pending_plan_id: null, pending_plan_version: null, pending_price_id: null, provider_authorization_code: null, provider_customer_code: null }],
          update: updateSpy,
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.applied).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled", pending_change_type: null }));
  });

  it("falls back to cancelled when a due downgrade has no stored authorization", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: null, provider_customer_code: null }],
          update: updateSpy,
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.failed).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
    expect(mocks.createSubscriptionForAuthorization).not.toHaveBeenCalled();
  });

  it("applies a due downgrade with a stored authorization", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createSubscriptionForAuthorization.mockResolvedValue({ subscriptionCode: "SUB_new", emailToken: "tok_new" });
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1" }],
          update: updateSpy,
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.applied).toBe(1);
    expect(mocks.createSubscriptionForAuthorization).toHaveBeenCalledWith({
      customerCode: "CUS_1", planCode: "PLN_growth", authorizationCode: "AUTH_1",
    });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "active", plan_id: "p1", pending_change_type: null }));
  });

  it("re-invoking after a row was already applied is a no-op", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_subscriptions: { select: [] } }));
    const response = await POST(request());
    const body = await response.json();
    expect(body).toEqual({ applied: 0, failed: 0, total: 0 });
  });
});
