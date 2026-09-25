// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), parse: vi.fn(), apply: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bnpl/registry", () => ({
  getBnplProviderById: (id: string) =>
    id === "sandbox" ? { id: "sandbox", verifyWebhook: mocks.verify, parseWebhook: mocks.parse } : null,
}));
vi.mock("@/lib/bnpl/capture", () => ({ applyBnplOutcome: mocks.apply }));

import { POST } from "./route";

function call(provider: string) {
  return POST(new Request(`http://localhost/api/payments/bnpl/webhook/${provider}`, { method: "POST", body: "{}" }), {
    params: Promise.resolve({ provider }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(true);
  mocks.parse.mockReturnValue([{ reference: "r1" }]);
  mocks.apply.mockResolvedValue("captured");
});

describe("POST /api/payments/bnpl/webhook/:provider", () => {
  it("applies verified outcomes", async () => {
    const response = await call("sandbox");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1, results: ["captured"] });
  });

  it("rejects an unsigned body before parsing it", async () => {
    mocks.verify.mockResolvedValue(false);
    expect((await call("sandbox")).status).toBe(401);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("404s an unknown provider", async () => {
    expect((await call("nobody")).status).toBe(404);
  });

  it("returns 5xx so the partner retries when applying fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.apply.mockRejectedValue(new Error("db down"));
    expect((await call("sandbox")).status).toBe(500);
  });
});
