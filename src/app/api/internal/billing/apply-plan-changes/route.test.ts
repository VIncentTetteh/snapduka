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

type UpdateResult = { data: unknown; error: unknown };

/** Chainable + thenable so both `.eq().eq()` and single `.eq()` call sites resolve. */
interface UpdateChain {
  eq: (column?: string, value?: unknown) => UpdateChain;
  then: <TResult1 = UpdateResult, TResult2 = never>(
    onfulfilled?: ((value: UpdateResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
}

function makeUpdateChain(respond: () => Promise<UpdateResult>): UpdateChain {
  const chain: UpdateChain = {
    eq: () => chain,
    then: (onfulfilled, onrejected) => respond().then(onfulfilled, onrejected),
  };
  return chain;
}

/** A minimal chainable Supabase query-builder mock, table-keyed. */
function adminMock(
  tables: Record<
    string,
    {
      select?: unknown;
      update?: (payload: unknown) => unknown;
      updateError?: unknown | ((payload: Record<string, unknown>) => unknown);
      // Simulates the supabase-js client throwing (network/client-level failure)
      // rather than resolving with { error }, for the payload(s) it matches.
      updateThrows?: (payload: Record<string, unknown>) => boolean;
    }
  >,
) {
  return {
    from: (table: string) => {
      const t = tables[table] ?? {};
      return {
        select: () => ({
          // The cron now filters `.in("pending_change_type", [...])` so a
          // pending UPGRADE — which waits on payment, not on a date — is never
          // swept up and charged as if it were a scheduled downgrade.
          in: () => ({ lte: () => Promise.resolve({ data: t.select }) }),
          not: () => ({ lte: () => Promise.resolve({ data: t.select }) }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: t.select }) }),
        }),
        update: (payload: unknown) => {
          t.update?.(payload);
          return makeUpdateChain(() => {
            if (t.updateThrows?.(payload as Record<string, unknown>)) {
              return Promise.reject(new Error("network failure"));
            }
            return Promise.resolve({
              data: null,
              error:
                typeof t.updateError === "function"
                  ? (t.updateError as (payload: Record<string, unknown>) => unknown)(payload as Record<string, unknown>)
                  : (t.updateError ?? null),
            });
          });
        },
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

  it("leaves the row untouched for retry when Paystack throws (no double-charge)", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createSubscriptionForAuthorization.mockRejectedValue(new Error("Paystack unavailable"));
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
    expect(body.failed).toBe(1);
    expect(body.applied).toBe(0);
    // The Paystack call threw before the success-path persist was ever attempted,
    // so no write happened for this row at all: pending_change_type is still set,
    // meaning the row remains "due" and will be retried next run.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ state: "active" }));
  });

  it("leaves the row untouched for retry when Paystack throws and current_period_end is within the grace period", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSubscriptionForAuthorization.mockRejectedValue(new Error("Paystack unavailable"));
    // current_period_end is 1 day in the past — well within DOWNGRADE_RETRY_GRACE_DAYS (3).
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1", current_period_end: oneDayAgo }],
          update: updateSpy,
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.failed).toBe(1);
    expect(body.applied).toBe(0);
    // Still within the grace period: no fail-safe update, pending_change_type
    // is left set so the row remains "due" and is retried next run.
    expect(updateSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("fails safe to Free when Paystack keeps throwing and current_period_end is past the grace period", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSubscriptionForAuthorization.mockRejectedValue(new Error("Paystack unavailable"));
    // current_period_end is 10 days in the past — past DOWNGRADE_RETRY_GRACE_DAYS (3).
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1", current_period_end: tenDaysAgo }],
          update: updateSpy,
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();

    // A fail-safe cancellation is not a successful downgrade.
    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);

    // Mirrors the no-authorization branch's update payload shape exactly.
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "cancelled",
        pending_change_type: null,
        pending_plan_id: null,
        pending_plan_version: null,
        pending_price_id: null,
      }),
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[apply-plan-changes] downgrade retry exhausted after grace period, failing safe to Free",
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
  });

  it("clears pending_change_type via a best-effort update when the charge succeeds but persist fails twice (no repeat charge tomorrow)", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSubscriptionForAuthorization.mockResolvedValue({ subscriptionCode: "SUB_new", emailToken: "tok_new" });
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1" }],
          update: updateSpy,
          // The full-state persist (payload includes plan_id) fails on both retry
          // attempts; the follow-up best-effort clear (payload is just
          // pending_change_type) succeeds.
          updateError: (payload: Record<string, unknown>) => ("plan_id" in payload ? { message: "persist failed" } : null),
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();

    // The charge happened but state was never correctly persisted, so this
    // row must still count as failed — only the pending marker was cleared,
    // as damage limitation, not a real success.
    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);

    // Two full-state persist attempts (the retry loop), then one minimal
    // best-effort clear of just pending_change_type.
    const fullPersistAttempts = updateSpy.mock.calls.filter(([payload]) => "plan_id" in (payload as object));
    const clearAttempts = updateSpy.mock.calls.filter(
      ([payload]) => !("plan_id" in (payload as object)) && (payload as Record<string, unknown>).pending_change_type === null,
    );
    expect(fullPersistAttempts).toHaveLength(2);
    expect(clearAttempts).toHaveLength(1);
    expect(clearAttempts[0][0]).toEqual({ pending_change_type: null });

    // A human must still be alerted to reconcile plan_id/state/current_period_end.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("needs manual reconciliation"),
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
  });

  it("logs an escalated warning when both the persist AND the best-effort pending_change_type clear fail", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSubscriptionForAuthorization.mockResolvedValue({ subscriptionCode: "SUB_new", emailToken: "tok_new" });
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1" }],
          update: updateSpy,
          // Every update attempt fails, including the best-effort clear.
          updateError: { message: "db unavailable" },
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();

    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ALSO FAILED"),
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
  });

  it("logs an escalated warning when the persist fails twice and the best-effort clear itself throws", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSubscriptionForAuthorization.mockResolvedValue({ subscriptionCode: "SUB_new", emailToken: "tok_new" });
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1" }],
          update: updateSpy,
          // The full-state persist (payload includes plan_id) fails on both retry
          // attempts via a returned { error }, same as the sibling test above. The
          // follow-up best-effort clear (payload is just pending_change_type),
          // however, THROWS instead of resolving with { error } — the other
          // supabase-js failure mode — and must still reach the escalated log.
          updateError: (payload: Record<string, unknown>) => ("plan_id" in payload ? { message: "persist failed" } : null),
          updateThrows: (payload) => !("plan_id" in payload),
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();

    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);

    // Two full-state persist attempts, then one thrown best-effort clear attempt.
    const fullPersistAttempts = updateSpy.mock.calls.filter(([payload]) => "plan_id" in (payload as object));
    const clearAttempts = updateSpy.mock.calls.filter(
      ([payload]) => !("plan_id" in (payload as object)) && (payload as Record<string, unknown>).pending_change_type === null,
    );
    expect(fullPersistAttempts).toHaveLength(2);
    expect(clearAttempts).toHaveLength(1);

    // The escalated "ALSO FAILED" log must fire even though the clear call threw
    // rather than resolving with { error } — not the unrelated outer/inner catch's
    // silent "pending_change_type left set — retried on the next run" path, which
    // logs nothing and would leave this row silently re-chargeable tomorrow.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ALSO FAILED"),
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
  });

  it("re-invoking after a row was already applied is a no-op", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_subscriptions: { select: [] } }));
    const response = await POST(request());
    const body = await response.json();
    expect(body).toEqual({ applied: 0, failed: 0, total: 0 });
  });
});
