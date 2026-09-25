import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  checkRateLimit: vi.fn(),
  listConversations: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/whatsapp/inbox", () => ({ listConversations: mocks.listConversations }));

import { GET } from "./route";

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: null,
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
});

describe("GET /api/mobile/v1/inbox", () => {
  it("lists the caller's conversations with the flag state", async () => {
    const response = await GET(new Request("http://localhost/api/mobile/v1/inbox?cursor=abc"));
    expect(await response.json()).toEqual({ enabled: true, conversations: [], nextCursor: null });
    expect(mocks.listConversations).toHaveBeenCalledWith("seller-1", { cursor: "abc" });
  });

  it("403s a role that cannot read customers", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "fulfillment" });
    expect((await GET(new Request("http://localhost/api/mobile/v1/inbox"))).status).toBe(403);
  });
});
