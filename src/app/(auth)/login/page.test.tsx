import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import LoginPage from "./page";

describe("LoginPage", () => {
  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED;
    delete process.env.NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED;
    delete process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED;
  });

  it("renders the sign-in form by default", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: /welcome back/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("/onboarding")).toBeInTheDocument();
  });

  it("switches to registration with a password strength meter", async () => {
    render(
      await LoginPage({ searchParams: Promise.resolve({ mode: "register" }) }),
    );

    expect(
      screen.getByRole("heading", { name: /create your account/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/use 8\+ characters with uppercase, lowercase and a number/i),
    ).toBeInTheDocument();
  });

  it("offers a magic-link mode without a password field", async () => {
    render(
      await LoginPage({ searchParams: Promise.resolve({ method: "magic" }) }),
    );

    expect(
      screen.getByRole("button", { name: /email me a magic link/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /use password instead/i }),
    ).toBeInTheDocument();
  });

  it("shows errors in the styled alert", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "Invalid email or password." }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
  });

  it("renders the check-email screen after sign-up", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          message: "Check your email to confirm your account.",
          next: "/onboarding",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: /check your email/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /i.?ve confirmed — continue/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("renders Google sign-in with a provider field only when enabled", async () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "true";

    const { container } = render(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('input[name="provider"][value="google"]'),
    ).not.toBeNull();

    cleanup();
    delete process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED;

    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });
});
