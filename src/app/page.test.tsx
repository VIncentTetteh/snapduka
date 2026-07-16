import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  afterEach(cleanup);

  it("leads with the social-checkout headline", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /your social audience is ready to buy\. give them a checkout\./i,
      }),
    ).toBeInTheDocument();
  });

  it("routes every storefront CTA to onboarding", () => {
    render(<HomePage />);

    expect(
      screen.getAllByRole("link", { name: /create your storefront/i }),
    ).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute("href") === "/onboarding"),
    );
  });

  it("shows the three plans with the Growth plan featured", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Growth" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scale" })).toBeInTheDocument();
    expect(screen.getByText("Most popular")).toBeInTheDocument();
  });

  it("links buyers to discovery and sellers to sign in", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("link", { name: /explore live stores/i }),
    ).toHaveAttribute("href", "/discover");
    expect(
      screen.getAllByRole("link", { name: /sign in/i }).length,
    ).toBeGreaterThan(0);
  });
});
