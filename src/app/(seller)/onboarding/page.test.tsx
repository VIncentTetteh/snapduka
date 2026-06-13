import { render, screen } from "@testing-library/react";
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

vi.mock("@/lib/auth/actor", () => ({
  resolveServerActor: mocks.resolveServerActor,
}));

vi.mock("@/components/seller/onboarding-form", () => ({
  OnboardingForm: () => <div>Seller onboarding form</div>,
}));

import OnboardingPage from "./page";

describe("OnboardingPage access states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects anonymous visitors to login with the onboarding return path", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "anonymous",
      authenticated: false,
    });

    await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fonboarding",
    );
  });

  it("handles operators without exposing a seller onboarding form", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "operator",
      authenticated: true,
      userId: "operator-id",
      email: "operator@example.com",
      role: "operator",
    });

    render(await OnboardingPage());

    expect(
      screen.getByRole("heading", { name: /seller onboarding unavailable/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("shows a read-only resolution state to suspended sellers", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller",
      authenticated: true,
      userId: "seller-user-id",
      email: "seller@example.com",
      sellerAccountId: "seller-id",
      country: "GH",
      status: "suspended",
    });

    render(await OnboardingPage());

    expect(
      screen.getByRole("heading", { name: /account needs resolution/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/onboarding is read-only/i)).toBeInTheDocument();
  });
});
