import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  transitionOrder: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/orders/transition", () => ({ transitionOrder: mocks.transitionOrder }));

import { POST } from "./route";

/**
 * The contract the mobile client is written against. Codes matter more than
 * messages here: the app has to tell "refetch and ask again" (409
 * version_conflict) apart from "your role cannot do this" (403), and it can
 * only do that if these are stable.
 */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

function call(body: unknown, orderId = ORDER_ID) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/orders/${orderId}/transition`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ orderId }) },
  );
}

async function envelope(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.transitionOrder.mockResolvedValue({
    ok: true,
    orderId: ORDER_ID,
    status: "confirmed",
    version: 2,
  });
});

describe("POST /api/mobile/v1/orders/[orderId]/transition", () => {
  it("transitions the order and returns the new version", async () => {
    const { status, body } = await envelope(
      await call({ status: "confirmed", expectedVersion: 1 }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ order: { id: ORDER_ID, status: "confirmed", version: 2 } });
    expect(mocks.transitionOrder).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      orderId: ORDER_ID,
      next: "confirmed",
      expectedVersion: 1,
      offlinePaidConfirmed: undefined,
    });
  });

  describe("authentication and authorization", () => {
    it("401s an anonymous caller", async () => {
      mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

      const { status, body } = await envelope(
        await call({ status: "confirmed", expectedVersion: 1 }),
      );

      expect(status).toBe(401);
      expect(body.error.code).toBe("unauthenticated");
      expect(mocks.transitionOrder).not.toHaveBeenCalled();
    });

    it("403s a role without orders.manage", async () => {
      mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });

      const { status, body } = await envelope(
        await call({ status: "confirmed", expectedVersion: 1 }),
      );

      expect(status).toBe(403);
      expect(body.error.code).toBe("forbidden");
    });

    // The owner has no team_memberships row, so actor.role is undefined. Reading
    // that as "no permissions" would lock every owner out of their own orders.
    it("treats an undefined role as the owner", async () => {
      mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: undefined });

      expect((await call({ status: "confirmed", expectedVersion: 1 })).status).toBe(200);
    });

    it("403s a suspended account", async () => {
      mocks.resolveServerActor.mockResolvedValue({ ...SELLER, status: "suspended" });

      const { status, body } = await envelope(
        await call({ status: "confirmed", expectedVersion: 1 }),
      );

      expect(status).toBe(403);
      expect(body.error.message).toMatch(/suspended/i);
    });
  });

  describe("validation", () => {
    it("422s a status only the system may set", async () => {
      const { status, body } = await envelope(
        await call({ status: "pending", expectedVersion: 1 }),
      );

      expect(status).toBe(422);
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.fields).toHaveProperty("status");
    });

    // Without a version two devices silently overwrite each other, so this is
    // required rather than defaulted.
    it("422s a body with no expectedVersion", async () => {
      const { status, body } = await envelope(await call({ status: "confirmed" }));

      expect(status).toBe(422);
      expect(body.error.fields).toHaveProperty("expectedVersion");
    });

    it("422s a malformed body", async () => {
      const response = await POST(
        new Request("http://localhost/x", { method: "POST", body: "not json" }),
        { params: Promise.resolve({ orderId: ORDER_ID }) },
      );

      expect(response.status).toBe(422);
    });

    it("404s a non-uuid order id without touching the database", async () => {
      const { status, body } = await envelope(
        await call({ status: "confirmed", expectedVersion: 1 }, "not-a-uuid"),
      );

      expect(status).toBe(404);
      expect(body.error.code).toBe("not_found");
      expect(mocks.transitionOrder).not.toHaveBeenCalled();
    });
  });

  describe("transition outcomes", () => {
    it.each([
      ["not_found", 404, "not_found"],
      ["version_conflict", 409, "version_conflict"],
      ["illegal_transition", 409, "conflict"],
      ["offline_unconfirmed", 409, "conflict"],
    ])("maps %s to %i", async (reason, expectedStatus, expectedCode) => {
      mocks.transitionOrder.mockResolvedValue({ ok: false, reason });

      const { status, body } = await envelope(
        await call({ status: "completed", expectedVersion: 1 }),
      );

      expect(status).toBe(expectedStatus);
      expect(body.error.code).toBe(expectedCode);
    });

    it("passes the offline-paid confirmation through", async () => {
      await call({ status: "completed", expectedVersion: 1, offlinePaidConfirmed: true });

      expect(mocks.transitionOrder).toHaveBeenCalledWith(
        expect.objectContaining({ offlinePaidConfirmed: true }),
      );
    });

    it("500s without leaking the underlying error", async () => {
      mocks.transitionOrder.mockRejectedValue(new Error("connection string: postgres://u:p@h"));

      const { status, body } = await envelope(
        await call({ status: "confirmed", expectedVersion: 1 }),
      );

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal");
      expect(JSON.stringify(body)).not.toContain("postgres://");
    });
  });

  describe("rate limiting", () => {
    it("429s with Retry-After once the limit is hit", async () => {
      mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 30_000 });

      const response = await call({ status: "confirmed", expectedVersion: 1 });

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(mocks.transitionOrder).not.toHaveBeenCalled();
    });

    it("scopes the limit to the seller account", async () => {
      await call({ status: "confirmed", expectedVersion: 1 });

      expect(mocks.checkRateLimit).toHaveBeenCalledWith(
        "mobile:orders.transition:seller-1",
        expect.objectContaining({ limit: 60 }),
      );
    });
  });

  it("stamps every error with a request id", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

    const { body } = await envelope(await call({ status: "confirmed", expectedVersion: 1 }));

    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
