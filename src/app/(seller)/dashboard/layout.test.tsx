import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  resolveServerActor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

// The layout reads the wa_outbound flag for the inbox link; this test only
// covers the redirect, which happens first.
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: async () => false }));

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
}));

import DashboardLayout from "./layout";

describe("DashboardLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an authenticated first-time seller to onboarding", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "unprovisioned",
      authenticated: true,
      userId: "user-id",
      email: "seller@example.com",
    });

    await expect(
      DashboardLayout({ children: <p>Dashboard</p> }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/onboarding");
  });
});
