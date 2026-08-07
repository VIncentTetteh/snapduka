import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  eqToken: vi.fn(),
  eqSeller: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { DELETE, POST } from "./route";

const TOKEN = "ExponentPushToken[abc123]";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/mobile/v1/devices", {
    method,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.eqSeller.mockResolvedValue({ error: null });
  mocks.eqToken.mockReturnValue({ eq: mocks.eqSeller });
  mocks.update.mockReturnValue({ eq: mocks.eqToken });
  mocks.createAdminClient.mockReturnValue({
    from: () => ({ upsert: mocks.upsert, update: mocks.update }),
  });
});

describe("POST /api/mobile/v1/devices", () => {
  it("registers the device against the verified seller", async () => {
    const response = await POST(request({ expoPushToken: TOKEN, platform: "ios" }));

    expect(response.status).toBe(201);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_account_id: "seller-1",
        auth_user_id: "user-1",
        expo_push_token: TOKEN,
        platform: "ios",
        active: true,
      }),
      { onConflict: "expo_push_token" },
    );
  });

  /**
   * The reason this route exists rather than an RLS insert policy: an attacker
   * who could name the account would receive another seller's order stream.
   * The body must never be able to influence which account a token lands on.
   */
  it("ignores a seller account id supplied in the body", async () => {
    await POST(
      request({
        expoPushToken: TOKEN,
        platform: "ios",
        seller_account_id: "victim",
        sellerAccountId: "victim",
      }),
    );

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ seller_account_id: "seller-1" }),
      expect.anything(),
    );
  });

  it("upserts on the token so a reinstall moves it rather than failing", async () => {
    await POST(request({ expoPushToken: TOKEN, platform: "android" }));

    expect(mocks.upsert.mock.calls[0][1]).toEqual({ onConflict: "expo_push_token" });
  });

  it.each([
    ["a non-Expo token", { expoPushToken: "fcm:abc", platform: "ios" }],
    ["an unsupported platform", { expoPushToken: TOKEN, platform: "windows" }],
    ["a missing token", { platform: "ios" }],
  ])("422s %s", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("401s an anonymous caller", async () => {
    mocks.resolveServerActor.mockResolvedValue({ kind: "anonymous", authenticated: false });

    const response = await POST(request({ expoPushToken: TOKEN, platform: "ios" }));

    expect(response.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("429s past the registration limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const response = await POST(request({ expoPushToken: TOKEN, platform: "ios" }));

    expect(response.status).toBe(429);
  });

  it("500s when the write fails", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "constraint violated" } });

    const response = await POST(request({ expoPushToken: TOKEN, platform: "ios" }));

    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/mobile/v1/devices", () => {
  it("deactivates rather than deletes, scoped to the caller's account", async () => {
    const response = await DELETE(request({ expoPushToken: TOKEN }, "DELETE"));

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ active: false });
    expect(mocks.eqToken).toHaveBeenCalledWith("expo_push_token", TOKEN);
    // Without this filter, knowing a token would let anyone silence another
    // seller's notifications.
    expect(mocks.eqSeller).toHaveBeenCalledWith("seller_account_id", "seller-1");
  });

  it("422s a token that is not an Expo token", async () => {
    const response = await DELETE(request({ expoPushToken: "nope" }, "DELETE"));

    expect(response.status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
