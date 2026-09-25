import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClassicLanding as HomePage } from "./classic-landing";

describe("ClassicLanding", () => {
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

  it("lists what paid plans add from plan data, not fixed copy", () => {
    render(
      <HomePage
        planFeatures={[
          { code: "free", features: ["Up to 50 products"] },
          { code: "growth", features: ["Up to 500 products", "Discount promotions"] },
          { code: "scale", features: ["15 staff accounts"] },
        ]}
      />,
    );

    expect(screen.getByText("Discount promotions")).toBeInTheDocument();
    expect(screen.getByText("15 staff accounts")).toBeInTheDocument();
    expect(screen.queryByText(/priority support|advanced analytics|sales analytics/i)).not.toBeInTheDocument();
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

  it("never promises that every order arrives paid — cash orders do not", () => {
    render(<HomePage />);
    expect(screen.queryByText(/every order arrives paid/i)).not.toBeInTheDocument();
  });
});
