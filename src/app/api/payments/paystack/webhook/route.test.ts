import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), enqueue: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { order_id: "o1" } }) }) }) }),
  }),
}));
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueOrderEventNotification: mocks.enqueue }));

import { POST } from "./route";

const SECRET = "sk_test_webhook";

function signed(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  return POST(
    new Request("http://localhost/api/payments/paystack/webhook", {
      method: "POST",
      headers: { "x-paystack-signature": createHmac("sha512", secret).update(raw).digest("hex") },
      body: raw,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYSTACK_SECRET_KEY", SECRET);
  mocks.rpc.mockResolvedValue({ data: "applied", error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/payments/paystack/webhook", () => {
  it("rejects a bad signature before touching the database", async () => {
    const response = await signed({ event: "charge.success", data: { reference: "r" } }, "wrong");
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("applies a charge.success and notifies", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await signed({ event: "charge.success", data: { id: 1, reference: "ref-1" } });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("apply_paystack_success", expect.objectContaining({
      p_reference: "ref-1",
      p_event_key: "charge.success:1",
    }));
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), "o1", "payment_succeeded");
  });

  it.each(["charge.dispute.create", "charge.dispute.remind", "charge.dispute.resolve"])(
    "routes %s to the chargeback ledger path",
    async (event) => {
      const body = { event, data: { id: 99, transaction: { reference: "ref-1" } } };
      const response = await signed(body);
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith("apply_paystack_dispute_event", {
        p_event_key: `${event}:99`,
        p_event: event,
        p_payload: body,
      });
    },
  );

  it("rejects a dispute event without a transaction reference", async () => {
    const response = await signed({ event: "charge.dispute.create", data: { id: 99 } });
    expect(response.status).toBe(400);
  });

  it("asks Paystack to retry when the dispute cannot be applied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const response = await signed({ event: "charge.dispute.create", data: { id: 99, transaction: { reference: "r" } } });
    expect(response.status).toBe(500);
  });
});
