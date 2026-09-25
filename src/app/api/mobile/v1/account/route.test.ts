import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  flagSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/flags", () => ({ flagSnapshot: mocks.flagSnapshot }));

import { GET } from "./route";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.flagSnapshot.mockResolvedValue({ protect: true, snap_to_list: false });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/mobile/v1/account", () => {
  it("returns the account and the seller's flag snapshot", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      account: { sellerAccountId: "seller-1", userId: "u1", country: "GH", status: "active", role: "owner" },
      flags: { protect: true, snap_to_list: false },
    });
    expect(mocks.flagSnapshot).toHaveBeenCalledWith("seller-1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  // Team members resolve with the owner's seller account id, so flags follow
  // the shop, not the person.
  it("serves every team role, with the shop's flags", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, userId: "u2", role: "fulfillment" });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account.role).toBe("fulfillment");
    expect(mocks.flagSnapshot).toHaveBeenCalledWith("seller-1");
  });

  it("401s an anonymous caller without evaluating flags", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.flagSnapshot).not.toHaveBeenCalled();
  });

  it("403s a suspended seller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, status: "suspended" });
    expect((await GET()).status).toBe(403);
  });

  it("rate-limits per seller", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 5000 });

    const response = await GET();

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("mobile:account.read:seller-1", expect.any(Object));
  });

  it("500s rather than inventing flags when the snapshot throws", async () => {
    mocks.flagSnapshot.mockRejectedValue(new Error("db down"));
    expect((await GET()).status).toBe(500);
  });
});
