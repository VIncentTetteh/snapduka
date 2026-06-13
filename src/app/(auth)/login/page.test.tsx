import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "./page";

describe("LoginPage", () => {
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
    expect(screen.getByText(/new sellers can create an account/i)).toBeInTheDocument();
  });
});
