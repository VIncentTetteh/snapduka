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

  it("shows Email/Phone tabs and no password field on the default step", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole("tab", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Phone" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send me a code/i })).toBeInTheDocument();
  });

  it("shows the code-entry screen when step=code", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ step: "code", identifier: "seller@example.com", next: "/dashboard" }),
    });
    render(page);

    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify and continue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend code/i })).toBeInTheDocument();
  });

  it("renders a message banner on the code step", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({
        step: "code",
        identifier: "seller@example.com",
        next: "/dashboard",
        message: "We sent a 6-digit code to your email.",
      }),
    });
    render(page);

    expect(screen.getByRole("status")).toHaveTextContent("We sent a 6-digit code to your email.");
  });

  it("renders an error banner", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ error: "That code is invalid or has expired." }),
    });
    render(page);

    expect(screen.getByRole("alert")).toHaveTextContent("That code is invalid or has expired.");
  });
});
