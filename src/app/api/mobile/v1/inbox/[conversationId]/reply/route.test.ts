import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  replyAsSeller: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/whatsapp/inbox", () => ({ MAX_REPLY_LENGTH: 4096, replyAsSeller: mocks.replyAsSeller }));

import { POST } from "./route";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: null,
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};
const ID = "11111111-1111-4111-8111-111111111111";

function call(body: unknown) {
  return POST(new Request(`http://localhost/api/mobile/v1/inbox/${ID}/reply`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ conversationId: ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.replyAsSeller.mockResolvedValue({ ok: true, wamid: "wamid.1" });
});

describe("POST /api/mobile/v1/inbox/[id]/reply", () => {
  it("replies as the caller's shop", async () => {
    const response = await call({ text: "  Yes we have it  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: { wamid: "wamid.1" } });
    expect(mocks.replyAsSeller).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      userId: "u1",
      conversationId: ID,
      text: "Yes we have it",
    });
  });

  it("tells the app the window closed, so it can show the template path", async () => {
    mocks.replyAsSeller.mockResolvedValue({ ok: false, reason: "window_closed" });
    const response = await call({ text: "hello" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "conflict", fields: { window: "closed" } });
  });

  it("403s a role without orders.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });
    expect((await call({ text: "hi" })).status).toBe(403);
    expect(mocks.replyAsSeller).not.toHaveBeenCalled();
  });

  it("422s an empty message", async () => {
    expect((await call({ text: "   " })).status).toBe(422);
  });

  it("404s another seller's conversation", async () => {
    mocks.replyAsSeller.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await call({ text: "hi" })).status).toBe(404);
  });
});
