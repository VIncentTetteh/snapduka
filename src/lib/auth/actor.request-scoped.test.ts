import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveServerActor()` with no injected dependencies is the path every route
 * handler and server action actually takes. These tests cover the wiring the
 * dependency-injected tests in actor.test.ts cannot reach: that the resolver
 * uses a request-scoped client, and that a Bearer token is passed to
 * `getUser()` rather than being silently ignored.
 *
 * That last point is the whole reason the mobile app can authenticate. A Bearer
 * client holds no session, so `getUser()` with no argument returns
 * AuthSessionMissingError and every mobile request resolves as anonymous.
 */

const mocks = vi.hoisted(() => ({
  createRequestScopedClient: vi.fn(),
  requestBearerJwt: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/request", () => ({
  createRequestScopedClient: mocks.createRequestScopedClient,
  requestBearerJwt: mocks.requestBearerJwt,
}));

import { resolveServerActor } from "./actor";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.c2ln";
const USER = { id: "user-1", email: "seller@example.com", app_metadata: {} };
const SELLER = { id: "seller-1", country: "GH", status: "active" };

function client() {
  return {
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: mocks.maybeSingle,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createRequestScopedClient.mockResolvedValue(client());
  mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: SELLER, error: null });
});

describe("resolveServerActor — request scoped", () => {
  it("passes the Bearer token to getUser so a mobile request resolves", async () => {
    mocks.requestBearerJwt.mockResolvedValue(JWT);

    await expect(resolveServerActor()).resolves.toMatchObject({
      kind: "seller",
      userId: "user-1",
      sellerAccountId: "seller-1",
    });
    expect(mocks.getUser).toHaveBeenCalledWith(JWT);
  });

  it("calls getUser with no argument for a cookie request, as before", async () => {
    mocks.requestBearerJwt.mockResolvedValue(null);

    await expect(resolveServerActor()).resolves.toMatchObject({ kind: "seller" });
    expect(mocks.getUser).toHaveBeenCalledWith(undefined);
  });

  it("resolves anonymous when the token is rejected by the auth server", async () => {
    mocks.requestBearerJwt.mockResolvedValue(JWT);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });

    await expect(resolveServerActor()).resolves.toEqual({
      kind: "anonymous",
      authenticated: false,
    });
  });

  it("still honours injected dependencies, bypassing the client entirely", async () => {
    await expect(
      resolveServerActor({
        getVerifiedUser: async () => ({ id: "u-2", email: null, appMetadata: {} }),
        getSellerByAuthUserId: async () => ({ id: "s-2", country: "NG", status: "active" }),
      }),
    ).resolves.toMatchObject({ kind: "seller", sellerAccountId: "s-2" });
    expect(mocks.createRequestScopedClient).not.toHaveBeenCalled();
  });
});
