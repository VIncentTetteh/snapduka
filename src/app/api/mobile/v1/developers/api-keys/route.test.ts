import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  issueApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/api-keys/issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-keys/issue")>();
  return { API_KEY_SCOPES: actual.API_KEY_SCOPES, issueApiKey: mocks.issueApiKey };
});

import { POST } from "./route";

/**
 * The plaintext token is in this response and nowhere else, so the route's job
 * is to be strict about who may ask for one.
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

/** A manager holds settings.manage but is not the account owner. */
const MANAGER = { ...OWNER, role: "manager" as const };

function request(body: unknown) {
  return new Request("http://localhost/api/mobile/v1/developers/api-keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OWNER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.issueApiKey.mockResolvedValue({ ok: true, token: "sk_live_abc123" });
});

describe("POST /api/mobile/v1/developers/api-keys", () => {
  it("returns the plaintext token once, for the owner", async () => {
    const response = await POST(request({ name: "Bot", scopes: ["orders:read"] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toBe("sk_live_abc123");
    expect(mocks.issueApiKey).toHaveBeenCalledWith(OWNER, {
      name: "Bot",
      scopes: ["orders:read"],
    });
  });

  it("refuses a manager — settings.manage is not enough to mint a credential", async () => {
    mocks.resolveServerActor.mockResolvedValue(MANAGER);

    const response = await POST(request({ scopes: ["orders:read"] }));

    expect(response.status).toBe(403);
    expect(mocks.issueApiKey).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "guest", authenticated: false });

    const response = await POST(request({ scopes: ["orders:read"] }));

    expect(response.status).toBe(401);
    expect(mocks.issueApiKey).not.toHaveBeenCalled();
  });

  it("rejects a scope outside the allow-list before doing any work", async () => {
    const response = await POST(request({ scopes: ["orders:write"] }));

    expect(response.status).toBe(422);
    expect(mocks.issueApiKey).not.toHaveBeenCalled();
  });

  it("rejects a request with no scopes at all", async () => {
    const response = await POST(request({ scopes: [] }));

    expect(response.status).toBe(422);
    expect(mocks.issueApiKey).not.toHaveBeenCalled();
  });

  it("reports a plan limit as plan_limit so the app can offer an upgrade", async () => {
    mocks.issueApiKey.mockResolvedValue({
      ok: false,
      reason: "plan_limit",
      message: "API access is not included in the Free plan.",
    });

    const response = await POST(request({ scopes: ["orders:read"] }));
    const body = await response.json();

    expect(body.error.code).toBe("plan_limit");
  });

  it("rate-limits key creation", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });

    const response = await POST(request({ scopes: ["orders:read"] }));

    expect(response.status).toBe(429);
    expect(mocks.issueApiKey).not.toHaveBeenCalled();
  });

  it("does not leak an unexpected failure as a token", async () => {
    mocks.issueApiKey.mockRejectedValue(new Error("pepper missing"));

    const response = await POST(request({ scopes: ["orders:read"] }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("pepper missing");
  });
});
