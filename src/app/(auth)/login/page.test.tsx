import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import LoginPage from "./page";

describe("LoginPage", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED;
    delete process.env.NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED;
    delete process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED;
  });

  it("renders accessible sign-in and account-creation forms", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          next: "/dashboard",
          message: "Check your email to confirm your account.",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: /seller access/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/email/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/password/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Check your email to confirm your account.",
    );
    expect(screen.queryByText(/onboarding|becomes available/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/sign in or create your seller account/i),
    ).toBeInTheDocument();
  });

  it("renders only social providers that are enabled", async () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "true";
    process.env.NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED = "false";

    render(
      await LoginPage({
        searchParams: Promise.resolve({ next: "/dashboard" }),
      }),
    );

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with facebook/i }),
    ).not.toBeInTheDocument();
  });

  it("uses onboarding as the default destination after authentication", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getAllByDisplayValue("/onboarding")).toHaveLength(2);
  });
});
