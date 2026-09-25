import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveServerActor: vi.fn(), checkRateLimit: vi.fn(), suggestCaptions: vi.fn() }));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/ai/captions", () => ({
  CAPTION_CHANNELS: ["whatsapp", "instagram", "tiktok", "snapchat"],
  suggestCaptions: mocks.suggestCaptions,
}));

import { POST } from "./route";

const SELLER = { kind: "seller", authenticated: true, userId: "u", email: null, sellerAccountId: "s1", country: "GH", status: "active" };
const PRODUCT = "0f000000-0000-4000-8000-000000000001";

function call(body: unknown) {
  return POST(new Request("http://localhost/api/mobile/v1/ai/caption", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.suggestCaptions.mockResolvedValue({ ok: true, captions: ["a"] });
});

describe("POST /api/mobile/v1/ai/caption", () => {
  it("suggests captions for the caller's product", async () => {
    const response = await call({ productId: PRODUCT, channel: "tiktok", language: "pcm" });
    expect(await response.json()).toEqual({ captions: ["a"] });
    expect(mocks.suggestCaptions).toHaveBeenCalledWith({ sellerAccountId: "s1", productId: PRODUCT, channel: "tiktok", language: "pcm" });
  });

  it("403s a role that cannot manage campaigns", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "fulfillment" });
    expect((await call({ productId: PRODUCT, channel: "tiktok" })).status).toBe(403);
  });

  it("maps a spent budget to plan_limit", async () => {
    mocks.suggestCaptions.mockResolvedValue({ ok: false, reason: "budget_exceeded", message: "m" });
    const response = await call({ productId: PRODUCT, channel: "tiktok" });
    expect((await response.json()).error.code).toBe("plan_limit");
  });
});
