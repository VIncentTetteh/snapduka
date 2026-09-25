import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  attempt: null as Record<string, unknown> | null,
  update: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueOrderEventNotification: mocks.notify }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: mocks.attempt, error: null });
      builder.update = (values: unknown) => {
        mocks.update(values);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
        return chain;
      };
      return builder;
    },
  }),
}));

import { applyBnplOutcome, bnplRouteReason } from "./capture";
import { BNPL_SANDBOX_SIGNATURE_HEADER, createSandboxBnplProvider } from "./sandbox";

const SECRET = "bnpl_secret";
const OUTCOME = {
  reference: "sd_abc123def456_1a2b3c4d",
  eventId: "evt_1",
  status: "approved" as const,
  amountMinor: 20_000,
  currency: "GHS" as const,
  feeMinor: 800,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attempt = { id: "a1", order_id: "o1", provider: "bnpl", route_reason: bnplRouteReason("sandbox"), status: "pending" };
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("sandbox BNPL provider", () => {
  it("is off unless enabled, and then offers 'Pay in 4' in GHS and NGN", () => {
    expect(createSandboxBnplProvider({ enabled: false }).status()).toBe("not_configured");
    const provider = createSandboxBnplProvider({ enabled: true, webhookSecret: SECRET });
    expect(provider.status()).toBe("ready");
    expect(provider.label).toBe("Pay in 4");
  });

  it("sends the buyer back to the order page; the decision comes by webhook", async () => {
    const provider = createSandboxBnplProvider({ enabled: true });
    const result = await provider.initialize({
      email: "a@b.c", amountMinor: 100, currency: "GHS", reference: "sd_x", callbackUrl: "https://s.test/orders/t", metadata: {},
    });
    expect(result.authorizationUrl).toBe("https://s.test/orders/t");
    expect((await provider.verify("sd_x")).status).toBe("pending");
  });

  it("verifies the signature and parses only well-formed outcomes", async () => {
    const provider = createSandboxBnplProvider({ enabled: true, webhookSecret: SECRET });
    const rawBody = JSON.stringify({
      outcomes: [OUTCOME, { ...OUTCOME, currency: "XOF" }, { ...OUTCOME, amountMinor: -1 }, { ...OUTCOME, status: "maybe" }],
    });
    const signature = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    expect(await provider.verifyWebhook({ rawBody, headers: { [BNPL_SANDBOX_SIGNATURE_HEADER]: signature } })).toBe(true);
    expect(await provider.verifyWebhook({ rawBody, headers: { [BNPL_SANDBOX_SIGNATURE_HEADER]: "0".repeat(64) } })).toBe(false);
    expect(provider.parseWebhook({ rawBody, headers: {} })).toEqual([OUTCOME]);
  });
});

describe("applyBnplOutcome", () => {
  it("captures an approval through the one shared capture path", async () => {
    expect(await applyBnplOutcome("sandbox", OUTCOME)).toBe("captured");
    expect(mocks.rpc).toHaveBeenCalledWith("apply_paystack_success", {
      p_reference: OUTCOME.reference,
      p_event_key: "bnpl:sandbox:evt_1",
      p_payload: {
        event: "bnpl.approved",
        data: {
          status: "success", reference: OUTCOME.reference, amount: 20_000, currency: "GHS", fees: 800,
          channel: "bnpl", partner: "sandbox",
        },
      },
    });
    expect(mocks.notify).toHaveBeenCalledWith(expect.anything(), "o1", "payment_succeeded");
  });

  it("never touches an attempt another provider started", async () => {
    mocks.attempt = { id: "a1", order_id: "o1", provider: "paystack", route_reason: "preferred", status: "pending" };
    expect(await applyBnplOutcome("sandbox", OUTCOME)).toBe("ignored");
    mocks.attempt = { id: "a1", order_id: "o1", provider: "bnpl", route_reason: bnplRouteReason("other"), status: "pending" };
    expect(await applyBnplOutcome("sandbox", OUTCOME)).toBe("ignored");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("marks a declined attempt failed without capturing", async () => {
    expect(await applyBnplOutcome("sandbox", { ...OUTCOME, status: "declined" })).toBe("declined");
    expect(mocks.update).toHaveBeenCalledWith({ status: "failed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not notify when the capture was refused or already applied", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await applyBnplOutcome("sandbox", OUTCOME)).toBe("not_applied");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
