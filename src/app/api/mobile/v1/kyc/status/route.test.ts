// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSeller: vi.fn(), getVerificationStatus: vi.fn() }));

vi.mock("@/lib/mobile/guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mobile/guard")>("@/lib/mobile/guard");
  return { ...actual, requireSeller: mocks.requireSeller };
});
vi.mock("@/lib/kyc/service", () => ({ getVerificationStatus: mocks.getVerificationStatus }));

import { GET } from "./route";

const OWNER = { kind: "seller", authenticated: true, userId: "u1", email: null, sellerAccountId: "seller-1", country: "GH", status: "active" };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/mobile/v1/kyc/status", () => {
  it("returns the owner's status", async () => {
    mocks.requireSeller.mockResolvedValue(OWNER);
    mocks.getVerificationStatus.mockResolvedValue({ state: "in_progress", automatic: "available", supportedTypes: [], checks: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("in_progress");
  });

  it("hides identity details from team members", async () => {
    mocks.requireSeller.mockResolvedValue({ ...OWNER, role: "manager" });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getVerificationStatus).not.toHaveBeenCalled();
  });
});
