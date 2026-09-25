// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  routeCheckout: vi.fn(),
  initialize: vi.fn(),
  settlementModeFor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));
vi.mock("@/lib/protect/service", () => ({ settlementModeFor: mocks.settlementModeFor }));
vi.mock("@/lib/bnpl/registry", () => ({ getActiveBnplProvider: () => ({ id: "sandbox", label: "Pay in 4" }) }));
vi.mock("@/lib/payments/providers/router", () => ({
  routeCheckout: mocks.routeCheckout,
  recordPaymentOutcome: async () => {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: table === "orders" ? mocks.order : null, error: null });
      builder.insert = (row: Record<string, unknown>) => {
        mocks.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "attempt-1" }, error: null }) }) };
      };
      builder.update = (row: Record<string, unknown>) => {
        mocks.updates.push(row);
        return { eq: async () => ({ error: null }) };
      };
      return builder;
    },
  }),
}));

import { POST } from "./route";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const ORDER = {
  id: ORDER_ID, seller_account_id: "seller-1", total_minor: 20_000, currency: "GHS",
  buyer_snapshot: { email: "ama@example.com" }, tracking_token: TOKEN, payment_method: "paystack", payment_status: "unpaid",
};
const BNPL_ROUTE = { provider: { id: "bnpl", adapter: () => ({ initialize: mocks.initialize }) }, reason: "preferred" };

function call() {
  return POST(new Request("http://localhost/api/payments/bnpl/initialize", {
    method: "POST",
    body: JSON.stringify({ orderId: ORDER_ID, trackingToken: TOKEN }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order = { ...ORDER };
  mocks.inserts = [];
  mocks.updates = [];
  mocks.settlementModeFor.mockResolvedValue("ledger");
  mocks.routeCheckout.mockResolvedValue([BNPL_ROUTE]);
  mocks.initialize.mockResolvedValue({ authorizationUrl: "https://bnpl.test/checkout", accessCode: "a", reference: "r" });
});

describe("POST /api/payments/bnpl/initialize", () => {
  it("starts a BNPL attempt bound to the partner and returns its checkout URL", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).authorizationUrl).toBe("https://bnpl.test/checkout");
    expect(mocks.routeCheckout).toHaveBeenCalledWith(expect.objectContaining({ method: "bnpl", country: "GH" }));
    expect(mocks.inserts[0]).toMatchObject({ provider: "bnpl", route_reason: "bnpl:sandbox", amount_minor: 20_000 });
  });

  it("is refused for a seller not on ledger settlement", async () => {
    mocks.settlementModeFor.mockResolvedValue("subaccount");
    expect((await call()).status).toBe(409);
    expect(mocks.inserts).toEqual([]);
  });

  it("is refused when BNPL is not routable (flag off or no partner)", async () => {
    mocks.routeCheckout.mockResolvedValue([]);
    expect((await call()).status).toBe(409);
    expect(mocks.inserts).toEqual([]);
  });

  it("does not fall back to pay-now when the partner fails: the attempt fails and the buyer is told", async () => {
    mocks.initialize.mockRejectedValue(new Error("down"));
    const response = await call();
    expect(response.status).toBe(502);
    expect(mocks.updates).toEqual([{ status: "failed" }]);
    expect(mocks.inserts).toHaveLength(1);
  });

  it("refuses a paid order or a wrong token", async () => {
    mocks.order = { ...ORDER, payment_status: "paid" };
    expect((await call()).status).toBe(409);
    mocks.order = null;
    expect((await call()).status).toBe(409);
  });
});
