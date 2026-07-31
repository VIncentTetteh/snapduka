import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  rpc: vi.fn(),
  attempt: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({ verify: mocks.verify }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.attempt }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}));

import { POST } from "./route";

function request(body: unknown, ip = "10.0.0.1") {
  return new Request("http://localhost/api/payments/paystack/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("paystack verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ ok: true });
  });

  it("rejects invalid references", async () => {
    const response = await POST(request({ reference: "x" }, "10.0.0.2"));
    expect(response.status).toBe(400);
  });

  it("404s for unknown payment attempts", async () => {
    mocks.attempt.mockResolvedValue({ data: null });
    const response = await POST(request({ reference: "sd_missing_ref" }, "10.0.0.3"));
    expect(response.status).toBe(404);
  });

  it("short-circuits when the attempt is already paid", async () => {
    mocks.attempt.mockResolvedValue({ data: { status: "paid" } });
    const response = await POST(request({ reference: "sd_paid_ref" }, "10.0.0.4"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentStatus: "paid" });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("applies a successful verification through the idempotent RPC", async () => {
    // The route reads the attempt, applies, then re-reads: by the second read
    // the RPC has marked it paid.
    mocks.attempt
      .mockResolvedValueOnce({ data: { status: "pending" } })
      // No order_id, so the notification enqueue is skipped — it has its own
      // tests and needs a deeper client mock than this route warrants.
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValue({ data: { status: "paid" } });
    mocks.verify.mockResolvedValue({
      status: "success",
      amountMinor: 45_000,
      currency: "GHS",
      reference: "sd_ok_ref",
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(request({ reference: "sd_ok_ref" }, "10.0.0.5"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentStatus: "paid" });
    expect(mocks.rpc).toHaveBeenCalledWith("apply_paystack_success", {
      p_reference: "sd_ok_ref",
      p_event_key: "verify:sd_ok_ref",
      p_payload: {
        source: "verify",
        data: { status: "success", amount: 45_000, currency: "GHS", reference: "sd_ok_ref" },
      },
    });
  });

  it("does not apply payment when the provider reports failure", async () => {
    mocks.attempt.mockResolvedValue({ data: { status: "pending" } });
    mocks.verify.mockResolvedValue({
      status: "failed",
      amountMinor: 45_000,
      currency: "GHS",
      reference: "sd_fail_ref",
    });

    const response = await POST(request({ reference: "sd_fail_ref" }, "10.0.0.6"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentStatus: "pending", providerStatus: "failed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  // Regression: `applied` is false both when nothing happened AND when the
  // webhook won the race and applied the payment first. Reporting the attempt
  // status captured before the RPC would tell a buyer their paid order is
  // still pending.
  it("reports paid when the webhook applied the payment first", async () => {
    mocks.attempt
      .mockResolvedValueOnce({ data: { status: "pending" } })
      .mockResolvedValue({ data: { status: "paid" } });
    mocks.verify.mockResolvedValue({
      status: "success",
      amountMinor: 45_000,
      currency: "GHS",
      reference: "sd_race_ref",
    });
    // The RPC's already-paid guard returns false without re-applying.
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(request({ reference: "sd_race_ref" }, "10.0.0.8"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentStatus: "paid" });
  });

  it("returns 502 when Paystack is unreachable", async () => {
    mocks.attempt.mockResolvedValue({ data: { status: "pending" } });
    mocks.verify.mockRejectedValue(new Error("network"));

    const response = await POST(request({ reference: "sd_down_ref" }, "10.0.0.7"));
    expect(response.status).toBe(502);
  });
});
