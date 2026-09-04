import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  planChange: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/billing/change-plan", () => ({ planChange: mocks.planChange }));

import { POST } from "./route";

/**
 * The app's Upgrade button used to open the web billing page, where the seller
 * arrived with no session — mobile keeps its session in SecureStore, never as a
 * browser cookie — and hit a login wall. The paid conversion path was a dead
 * end.
 *
 * This route hands back Paystack's checkout URL instead, which needs no
 * SnapDuka session at all.
 */

const OWNER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "owner@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

/** Staff carry a role; the owner is the one who has none. */
const STAFF = { ...OWNER, role: "manager" as const };

function request(body: unknown) {
  return new Request("http://localhost/api/mobile/v1/billing/change-plan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.planChange.mockResolvedValue({
    ok: true,
    kind: "checkout",
    authorizationUrl: "https://checkout.paystack.com/abc123",
  });
});

describe("POST /api/mobile/v1/billing/change-plan", () => {
  it("returns the Paystack checkout URL for an upgrade", async () => {
    const response = await POST(request({ planCode: "growth", interval: "monthly" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authorizationUrl).toBe("https://checkout.paystack.com/abc123");
    expect(mocks.planChange).toHaveBeenCalledWith(OWNER, {
      planCode: "growth",
      interval: "monthly",
    });
  });

  it("reports a downgrade as scheduled, with nothing to pay", async () => {
    mocks.planChange.mockResolvedValue({
      ok: true,
      kind: "scheduled",
      message: "Your plan will move to Free at the end of the current period.",
    });

    const response = await POST(request({ planCode: "free" }));
    const body = await response.json();

    expect(body.kind).toBe("scheduled");
    expect(body.authorizationUrl).toBeUndefined();
  });

  it("passes a missing interval through as null — keep the current cadence", async () => {
    await POST(request({ planCode: "scale" }));

    expect(mocks.planChange).toHaveBeenCalledWith(OWNER, { planCode: "scale", interval: null });
  });

  it("refuses staff, who cannot manage billing", async () => {
    mocks.resolveServerActor.mockResolvedValue(STAFF);

    const response = await POST(request({ planCode: "growth" }));

    expect(response.status).toBe(403);
    expect(mocks.planChange).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const response = await POST(request({ planCode: "growth" }));

    expect(response.status).toBe(401);
    expect(mocks.planChange).not.toHaveBeenCalled();
  });

  it("rejects a plan code that does not exist before doing any work", async () => {
    const response = await POST(request({ planCode: "enterprise" }));

    expect(response.status).toBe(422);
    expect(mocks.planChange).not.toHaveBeenCalled();
  });

  it("surfaces a refusal instead of pretending the change happened", async () => {
    mocks.planChange.mockResolvedValue({ ok: false, message: "You are already on this plan." });

    const response = await POST(request({ planCode: "growth" }));
    const body = await response.json();

    expect(body.error.message).toBe("You are already on this plan.");
  });

  it("rate-limits plan changes, which create Paystack plans and rows", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });

    const response = await POST(request({ planCode: "growth" }));

    expect(response.status).toBe(429);
    expect(mocks.planChange).not.toHaveBeenCalled();
  });

  it("does not leak an unexpected failure as a success", async () => {
    mocks.planChange.mockRejectedValue(new Error("paystack exploded"));

    const response = await POST(request({ planCode: "growth" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("paystack exploded");
  });
});
