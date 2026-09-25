// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSeller: vi.fn(),
  enforceRateLimit: vi.fn(),
  startVerification: vi.fn(),
}));

vi.mock("@/lib/mobile/guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mobile/guard")>("@/lib/mobile/guard");
  return { ...actual, requireSeller: mocks.requireSeller, enforceRateLimit: mocks.enforceRateLimit };
});
vi.mock("@/lib/kyc/service", () => ({ startVerification: mocks.startVerification }));
vi.mock("@/lib/kyc/provider", () => ({ KYC_CHECK_TYPES: ["ghana_card", "liveness", "business_reg"] }));

import { POST } from "./route";

const OWNER = { kind: "seller", authenticated: true, userId: "u1", email: null, sellerAccountId: "seller-1", country: "GH", status: "active" };

function request(body: unknown) {
  return new Request("http://localhost/api/mobile/v1/kyc/start", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSeller.mockResolvedValue(OWNER);
  mocks.enforceRateLimit.mockResolvedValue(null);
});

describe("POST /api/mobile/v1/kyc/start", () => {
  it("returns the SDK token and hosted URL", async () => {
    mocks.startVerification.mockResolvedValue({ ok: true, checkId: "c1", redirectUrl: "https://v.test", sdkToken: "tok" });
    const response = await POST(request({ type: "ghana_card" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ checkId: "c1", redirectUrl: "https://v.test", sdkToken: "tok" });
    expect(mocks.startVerification).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAccountId: "seller-1", type: "ghana_card", returnUrl: "snapduka://settings/verification" }),
    );
  });

  it("refuses a team member, even a manager", async () => {
    mocks.requireSeller.mockResolvedValue({ ...OWNER, role: "manager" });
    const response = await POST(request({ type: "ghana_card" }));
    expect(response.status).toBe(403);
    expect(mocks.startVerification).not.toHaveBeenCalled();
  });

  it("reports a disabled feature as forbidden", async () => {
    mocks.startVerification.mockResolvedValue({ ok: false, reason: "disabled", message: "Not yet." });
    const response = await POST(request({ type: "ghana_card" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe("Not yet.");
  });

  it("validates the check type", async () => {
    const response = await POST(request({ type: "passport" }));
    expect(response.status).toBe(422);
  });
});
