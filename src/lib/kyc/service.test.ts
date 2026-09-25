// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  rpc: vi.fn(),
  tables: {} as Record<string, unknown>,
}));

vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: mocks.tables[table] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: mocks.tables[table] ?? [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

import { createSandboxKycProvider } from "./providers/sandbox";
import { setKycProvidersForTests } from "./registry";
import { applyKycResult, getVerificationStatus, startVerification } from "./service";

const sandbox = createSandboxKycProvider({ enabled: true, autoResult: "passed" });
const base = {
  sellerAccountId: "seller-1",
  country: "GH" as const,
  type: "ghana_card" as const,
  returnUrl: "https://app.test/dashboard/settings/verification",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: "check-1", error: null });
  setKycProvidersForTests([sandbox]);
  vi.stubEnv("KYC_PROVIDER", "sandbox");
});

describe("startVerification", () => {
  it("does nothing while kyc_auto is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await startVerification({ ...base, provider: sandbox })).toMatchObject({ ok: false, reason: "disabled" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does nothing without a configured vendor", async () => {
    vi.stubEnv("KYC_PROVIDER", "");
    expect(await startVerification(base)).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("starts a check and records it", async () => {
    const result = await startVerification({ ...base, provider: sandbox });
    expect(result).toMatchObject({ ok: true, checkId: "check-1" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "start_kyc_check",
      expect.objectContaining({ p_seller_account_id: "seller-1", p_provider: "sandbox", p_check_type: "ghana_card" }),
    );
  });

  it("will not start an identity check for a verified seller", async () => {
    mocks.tables.seller_verifications = { state: "verified" };
    expect(await startVerification({ ...base, provider: sandbox })).toMatchObject({ ok: false, reason: "already_verified" });
  });

  it("will not start anything while an operator has the account on hold", async () => {
    mocks.tables.seller_verifications = { state: "rejected" };
    expect(await startVerification({ ...base, provider: sandbox })).toMatchObject({ ok: false, reason: "locked" });
  });
});

describe("applyKycResult", () => {
  it("passes the normalised result to the definer function", async () => {
    mocks.rpc.mockResolvedValue({
      data: { applied: true, checkId: "c1", sellerAccountId: "seller-1", status: "passed", verificationState: "verified" },
      error: null,
    });
    const outcome = await applyKycResult("sandbox", {
      providerRef: "ref-1",
      status: "passed",
      matchScore: 97,
      maskedId: "GHA-*******89-0",
      failureReason: null,
      details: { jobId: "j1" },
    });
    expect(outcome).toMatchObject({ applied: true, verificationState: "verified" });
    expect(mocks.rpc).toHaveBeenCalledWith("apply_kyc_result", expect.objectContaining({
      p_provider: "sandbox", p_provider_ref: "ref-1", p_status: "passed", p_result: { jobId: "j1" },
    }));
  });

  it("throws on a database error so the webhook is retried", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      applyKycResult("sandbox", { providerRef: "r", status: "passed", matchScore: null, maskedId: null, failureReason: null, details: {} }),
    ).rejects.toThrow(/boom/);
  });
});

describe("getVerificationStatus", () => {
  it("polls a stale pending check when its webhook never came", async () => {
    mocks.tables.kyc_checks = [
      { id: "c1", provider: "sandbox", provider_ref: "ref-1", check_type: "ghana_card", status: "pending",
        masked_id: null, failure_reason: null, created_at: "2026-09-25T09:00:00Z", completed_at: null },
    ];
    mocks.tables.seller_verifications = { state: "in_progress" };
    mocks.rpc.mockResolvedValue({ data: { applied: true, checkId: "c1", sellerAccountId: "seller-1", status: "passed" }, error: null });

    const status = await getVerificationStatus({ sellerAccountId: "seller-1", country: "GH", now: new Date("2026-09-25T10:00:00Z") });

    expect(mocks.rpc).toHaveBeenCalledWith("apply_kyc_result", expect.objectContaining({ p_provider_ref: "ref-1", p_status: "passed" }));
    expect(status.automatic).toBe("available");
    expect(status.checks[0]).toMatchObject({ id: "c1", checkType: "ghana_card" });
  });

  it("does not poll a check that is still fresh", async () => {
    mocks.tables.kyc_checks = [
      { id: "c1", provider: "sandbox", provider_ref: "ref-1", check_type: "ghana_card", status: "pending",
        masked_id: null, failure_reason: null, created_at: "2026-09-25T09:59:30Z", completed_at: null },
    ];
    await getVerificationStatus({ sellerAccountId: "seller-1", country: "GH", now: new Date("2026-09-25T10:00:00Z") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
