// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), parse: vi.fn(), apply: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/financing/partner", () => ({
  getFinancingPartner: (id: string) =>
    id === "sandbox"
      ? { id: "sandbox", verifyWebhook: mocks.verify, parseWebhook: mocks.parse }
      : { id: "not_configured", verifyWebhook: async () => false, parseWebhook: () => [] },
}));
vi.mock("@/lib/financing/service", () => ({ applyFinancingPartnerEvent: mocks.apply }));

import { POST } from "./route";

function call(partner: string) {
  return POST(new Request(`http://localhost/api/financing/partner/webhook/${partner}`, { method: "POST", body: "{}" }), {
    params: Promise.resolve({ partner }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(true);
  mocks.parse.mockReturnValue([{ type: "advance.funded", advanceId: "a", partnerReference: "p" }]);
  mocks.apply.mockResolvedValue({ applied: true });
});

describe("POST /api/financing/partner/webhook/:partner", () => {
  it("applies verified events under the partner named in the URL", async () => {
    const response = await call("sandbox");
    expect(await response.json()).toEqual({ received: 1, applied: 1 });
    expect(mocks.apply).toHaveBeenCalledWith("sandbox", expect.objectContaining({ type: "advance.funded" }));
  });

  it("404s a partner that is unknown or not configured", async () => {
    expect((await call("not_configured")).status).toBe(404);
    expect((await call("acme")).status).toBe(404);
  });

  it("rejects an unsigned body before parsing", async () => {
    mocks.verify.mockResolvedValue(false);
    expect((await call("sandbox")).status).toBe(401);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("returns 5xx so the partner retries when applying fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.apply.mockRejectedValue(new Error("db"));
    expect((await call("sandbox")).status).toBe(500);
  });
});
