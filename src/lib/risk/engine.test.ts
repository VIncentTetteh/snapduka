// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  rows: {} as Record<string, unknown>,
  upserts: [] as { rows: Record<string, unknown>[]; options: unknown }[],
}));

/**
 * Head-count queries resolve to mocks.counts[table]; single-row reads to
 * mocks.rows[table]. Upserts into risk_signals are captured.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "in", "not"]) builder[method] = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: mocks.rows[table] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: mocks.counts[table] ?? 0, error: null }).then(resolve);
      builder.upsert = (rows: Record<string, unknown>[], options: unknown) => {
        mocks.upserts.push({ rows, options });
        return Promise.resolve({ error: null });
      };
      return builder;
    },
  }),
}));

import { assessCheckoutRisk, assessKycRisk, assessPayoutRisk } from "./engine";
import { RISK_RULES_VERSION } from "./signals";

const NOW = new Date("2026-09-25T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.counts = {};
  mocks.upserts.length = 0;
  mocks.rows = {
    seller_accounts: { created_at: "2026-09-20T12:00:00Z" }, // 5 days old
    orders: {
      id: "order-1",
      seller_account_id: "seller-1",
      total_minor: 500_000,
      currency: "GHS",
      buyer_snapshot: { email: "ama@test" },
    },
  };
});

describe("assessCheckoutRisk", () => {
  it("records what fires, deduped per rule and order, with the rules version", async () => {
    mocks.counts.orders = 6;
    const findings = await assessCheckoutRisk("order-1", NOW);

    expect(findings.map((f) => f.rule)).toEqual(["buyer_order_velocity", "new_account_high_value_order"]);
    const [{ rows, options }] = mocks.upserts;
    expect(options).toEqual({ onConflict: "dedupe_key", ignoreDuplicates: true });
    expect(rows[0]).toMatchObject({
      seller_account_id: "seller-1",
      signal_type: "buyer_order_velocity",
      context: "checkout_init",
      rules_version: RISK_RULES_VERSION,
      dedupe_key: "buyer_order_velocity:order-1",
    });
  });

  it("writes nothing when nothing fires", async () => {
    mocks.rows.seller_accounts = { created_at: "2024-01-01T00:00:00Z" };
    mocks.counts.orders = 1;
    expect(await assessCheckoutRisk("order-1", NOW)).toEqual([]);
    expect(mocks.upserts).toEqual([]);
  });

  it("does nothing for an unknown order", async () => {
    mocks.rows.orders = null;
    expect(await assessCheckoutRisk("nope", NOW)).toEqual([]);
  });
});

describe("assessPayoutRisk", () => {
  it("uses exact counts for rates and velocity", async () => {
    mocks.counts = { payout_requests: 3, orders: 10, support_cases: 1, payment_attempts: 0 };
    const findings = await assessPayoutRisk(
      { sellerAccountId: "seller-1", amountMinor: 300_000, currency: "GHS", requestKey: "payout:k1" },
      NOW,
    );
    expect(findings.map((f) => f.rule)).toEqual(["payout_velocity", "new_account_high_value_payout", "seller_rates"]);
    expect(mocks.upserts[0].rows[0]).toMatchObject({ dedupe_key: "payout_velocity:payout:k1", context: "payout_request" });
  });
});

describe("assessKycRisk", () => {
  it("records a mismatch", async () => {
    const findings = await assessKycRisk({ sellerAccountId: "seller-1", checkId: "c1", status: "failed", matchScore: 10 }, NOW);
    expect(findings.map((f) => f.rule)).toEqual(["kyc_mismatch"]);
    expect(mocks.upserts[0].rows[0]).toMatchObject({ dedupe_key: "kyc_mismatch:c1", context: "kyc_result" });
  });
});
