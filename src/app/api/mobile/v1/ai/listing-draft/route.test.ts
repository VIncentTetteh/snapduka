import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  createListingDraft: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/ai/listing-draft", () => ({ createListingDraft: mocks.createListingDraft }));

import { POST } from "./route";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/mobile/v1/ai/listing-draft", { method: "POST", body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.createListingDraft.mockResolvedValue({ ok: true, draft: { title: "Shea", status: "draft" } });
});

describe("POST /api/mobile/v1/ai/listing-draft", () => {
  it("drafts from an uploaded photo path", async () => {
    const response = await call({ image: { path: "seller-1/p/i.jpg" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draft: { title: "Shea", status: "draft" } });
    expect(mocks.createListingDraft).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      image: { kind: "storage", path: "seller-1/p/i.jpg" },
    });
  });

  it("drafts from inline base64", async () => {
    await call({ image: { base64: "aGVsbG8gd29ybGQhIQ==", mediaType: "image/png" } });
    expect(mocks.createListingDraft).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      image: { kind: "base64", data: "aGVsbG8gd29ybGQhIQ==", mediaType: "image/png" },
    });
  });

  it("403s a role that cannot manage products", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });
    const response = await call({ image: { path: "seller-1/p/i.jpg" } });
    expect(response.status).toBe(403);
    expect(mocks.createListingDraft).not.toHaveBeenCalled();
  });

  it("422s an unsupported media type", async () => {
    const response = await call({ image: { base64: "aGVsbG8gd29ybGQhIQ==", mediaType: "image/gif" } });
    expect(response.status).toBe(422);
  });

  it.each([
    ["not_enabled", 403, "forbidden"],
    ["budget_exceeded", 403, "plan_limit"],
    ["invalid_image", 422, "validation_failed"],
    ["not_configured", 409, "conflict"],
    ["failed", 500, "internal"],
  ])("maps %s to %i %s", async (reason, status, code) => {
    mocks.createListingDraft.mockResolvedValue({ ok: false, reason, message: "nope" });
    const response = await call({ image: { path: "seller-1/p/i.jpg" } });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("429s past the rate limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 5000 });
    expect((await call({ image: { path: "seller-1/p/i.jpg" } })).status).toBe(429);
  });
});
