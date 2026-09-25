// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSeller: vi.fn(),
  enforceRateLimit: vi.fn(),
  acceptFinancingOffer: vi.fn(),
}));

vi.mock("@/lib/mobile/guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mobile/guard")>("@/lib/mobile/guard");
  return { ...actual, requireSeller: mocks.requireSeller, enforceRateLimit: mocks.enforceRateLimit };
});
vi.mock("@/lib/financing/service", () => ({ acceptFinancingOffer: mocks.acceptFinancingOffer }));

import { POST } from "./route";

const OWNER = { kind: "seller", authenticated: true, userId: "u1", email: null, sellerAccountId: "seller-1", country: "GH", status: "active" };
const OFFER = "33333333-3333-4333-8333-333333333333";
const BODY = { expectedTotalMinor: 198_750, termsVersion: "v1", confirm: true };

function call(body: unknown, id = OFFER) {
  return POST(new Request(`http://localhost/api/financing/offers/${id}/accept`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSeller.mockResolvedValue(OWNER);
  mocks.enforceRateLimit.mockResolvedValue(null);
});

describe("POST /api/financing/offers/:id/accept", () => {
  it("accepts with the exact numbers the seller confirmed", async () => {
    mocks.acceptFinancingOffer.mockResolvedValue({ ok: true, advanceId: "adv-1", state: "disbursed" });
    const response = await call(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ advanceId: "adv-1", state: "disbursed" });
    expect(mocks.acceptFinancingOffer).toHaveBeenCalledWith({
      sellerAccountId: "seller-1", userId: "u1", offerId: OFFER, expectedTotalMinor: 198_750, termsVersion: "v1",
    });
  });

  it("refuses a team member: only the owner takes on a debt", async () => {
    mocks.requireSeller.mockResolvedValue({ ...OWNER, role: "manager" });
    expect((await call(BODY)).status).toBe(403);
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation", async () => {
    const response = await call({ ...BODY, confirm: false });
    expect(response.status).toBe(422);
    expect(mocks.acceptFinancingOffer).not.toHaveBeenCalled();
  });

  it("maps a refusal to a conflict with the database's message", async () => {
    mocks.acceptFinancingOffer.mockResolvedValue({ ok: false, reason: "refused", message: "The terms have changed." });
    const response = await call(BODY);
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe("The terms have changed.");
  });

  it("treats a malformed id as not found", async () => {
    expect((await call(BODY, "nope")).status).toBe(404);
  });
});
