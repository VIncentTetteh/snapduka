// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSeller: vi.fn(), enforceRateLimit: vi.fn(), moveAdBudget: vi.fn() }));

vi.mock("@/lib/mobile/guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mobile/guard")>("@/lib/mobile/guard");
  return { ...actual, requireSeller: mocks.requireSeller, enforceRateLimit: mocks.enforceRateLimit };
});
vi.mock("@/lib/ads/service", () => ({ moveAdBudget: mocks.moveAdBudget }));

import { POST } from "./route";

const OWNER = { kind: "seller", authenticated: true, userId: "u1", email: null, sellerAccountId: "seller-1", country: "GH", status: "active" };
const BODY = { direction: "top_up", amountMinor: 1_000, idempotencyKey: "ads:0f0c4f7e-1" };

function call(body: unknown) {
  return POST(new Request("http://localhost/api/ads/budget", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSeller.mockResolvedValue(OWNER);
  mocks.enforceRateLimit.mockResolvedValue(null);
  mocks.moveAdBudget.mockResolvedValue({ ok: true, value: null });
});

describe("POST /api/ads/budget", () => {
  it("moves money for the owner, passing the idempotency key through", async () => {
    expect((await call(BODY)).status).toBe(200);
    expect(mocks.moveAdBudget).toHaveBeenCalledWith({ sellerAccountId: "seller-1", ...BODY });
  });

  it("refuses a team member: wallet money is the owner's to direct", async () => {
    mocks.requireSeller.mockResolvedValue({ ...OWNER, role: "manager" });
    expect((await call(BODY)).status).toBe(403);
    expect(mocks.moveAdBudget).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed idempotency key", async () => {
    expect((await call({ ...BODY, idempotencyKey: "x" })).status).toBe(422);
    expect(mocks.moveAdBudget).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal", async () => {
    mocks.moveAdBudget.mockResolvedValue({ ok: false, reason: "refused", message: "Not enough available balance for this top-up." });
    const response = await call(BODY);
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/Not enough/);
  });
});
