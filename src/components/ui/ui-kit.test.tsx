import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, VerifiedBadge } from "./badge";
import { Button, buttonClasses } from "./button";
import { EmptyState } from "./empty-state";
import { gradientForSeed, InitialsAvatar } from "./gradient-placeholder";
import { MetricTile } from "./metric-tile";
import { Timeline } from "./timeline";

describe("Badge", () => {
  it("renders tone styling and content", () => {
    render(<Badge tone="success">Paid</Badge>);
    const badge = screen.getByText("Paid");
    expect(badge.className).toContain("bg-success-tint");
  });

  it("renders the verified seller badge", () => {
    render(<VerifiedBadge />);
    expect(screen.getByText("Verified seller")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("defaults to type=button and primary variant", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("bg-accent");
  });

  it("reserves the success variant for payment/verification actions", () => {
    expect(buttonClasses("success")).toContain("bg-success");
  });
});

describe("MetricTile", () => {
  it("shows label, value and sub text", () => {
    render(<MetricTile label="Revenue · 30 days" value="GHS 12,480" sub="46 paid orders" />);
    expect(screen.getByText("Revenue · 30 days")).toBeInTheDocument();
    expect(screen.getByText("GHS 12,480")).toBeInTheDocument();
    expect(screen.getByText("46 paid orders")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title and body", () => {
    render(<EmptyState title="No orders yet" body="Share your storefront to get your first order." />);
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  it("renders every step title", () => {
    render(
      <Timeline
        steps={[
          { title: "Order placed", state: "done" },
          { title: "Payment received via Paystack", state: "done" },
          { title: "Out for delivery", state: "current" },
          { title: "Delivered", state: "pending" },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Payment received via Paystack")).toBeInTheDocument();
  });
});

describe("gradientForSeed", () => {
  it("is deterministic for the same seed", () => {
    expect(gradientForSeed("two-piece-linen-set")).toBe(gradientForSeed("two-piece-linen-set"));
  });

  it("always returns a warm gradient", () => {
    expect(gradientForSeed("anything")).toMatch(/^linear-gradient\(140deg,/);
  });
});

describe("InitialsAvatar", () => {
  it("derives up to two initials", () => {
    render(<InitialsAvatar name="Ama Serwaa" />);
    expect(screen.getByText("AS")).toBeInTheDocument();
  });
});
