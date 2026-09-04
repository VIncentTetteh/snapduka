import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  inviteTeamMember: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/team/invite", () => ({ inviteTeamMember: mocks.inviteTeamMember }));

import { POST } from "./route";

/**
 * The app used to send sellers to the web dashboard to invite a teammate, where
 * they arrived with no session — mobile keeps its session in SecureStore, never
 * as a browser cookie — and hit a login wall. This route is what replaced that,
 * so it carries the whole contract: only the owner may call it, failures are
 * reported with a code the app can branch on, and nothing is silent.
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
  return new Request("http://localhost/api/mobile/v1/team/invitations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.inviteTeamMember.mockResolvedValue({ ok: true });
});

describe("POST /api/mobile/v1/team/invitations", () => {
  it("invites a teammate for the account owner", async () => {
    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));

    expect(response.status).toBe(201);
    expect(mocks.inviteTeamMember).toHaveBeenCalledWith(
      { sellerAccountId: "seller-1", userId: "user-1" },
      { email: "kofi@example.com", role: "manager" },
    );
  });

  it("refuses staff, who cannot manage the team", async () => {
    mocks.resolveServerActor.mockResolvedValue(STAFF);

    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));

    expect(response.status).toBe(403);
    expect(mocks.inviteTeamMember).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));

    expect(response.status).toBe(401);
    expect(mocks.inviteTeamMember).not.toHaveBeenCalled();
  });

  it("reports a seat limit as plan_limit so the app can offer an upgrade", async () => {
    mocks.inviteTeamMember.mockResolvedValue({
      ok: false,
      reason: "seat_limit",
      message: "Your Free plan includes 1 staff account (the owner).",
    });

    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));
    const body = await response.json();

    expect(body.error.code).toBe("plan_limit");
    expect(body.error.message).toContain("Free plan");
  });

  it("returns a field-level message for a bad address", async () => {
    mocks.inviteTeamMember.mockResolvedValue({
      ok: false,
      reason: "invalid",
      field: "email",
      message: "Enter a valid email address.",
    });

    const response = await POST(request({ email: "nope", role: "manager" }));
    const body = await response.json();

    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields.email).toBe("Enter a valid email address.");
  });

  it("rejects a malformed body before doing any work", async () => {
    const response = await POST(request({ role: "manager" }));

    // 422 is the guard's convention for a body that parsed but failed schema.
    expect(response.status).toBe(422);
    expect(mocks.inviteTeamMember).not.toHaveBeenCalled();
  });

  it("rate-limits invitations rather than letting them be sprayed", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });

    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));

    expect(response.status).toBe(429);
    expect(mocks.inviteTeamMember).not.toHaveBeenCalled();
  });

  it("does not leak an unexpected failure as a success", async () => {
    mocks.inviteTeamMember.mockRejectedValue(new Error("smtp exploded"));

    const response = await POST(request({ email: "kofi@example.com", role: "manager" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal");
    // The upstream detail stays server-side.
    expect(JSON.stringify(body)).not.toContain("smtp exploded");
  });
});
