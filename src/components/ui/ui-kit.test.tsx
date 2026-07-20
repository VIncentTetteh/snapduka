import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: vi.fn() };
});

import { useFormStatus } from "react-dom";

import { Badge, VerifiedBadge } from "./badge";
import { Button, buttonClasses } from "./button";
import { EmptyState } from "./empty-state";
import { gradientForSeed, InitialsAvatar } from "./gradient-placeholder";
import { MetricTile } from "./metric-tile";
import { FormActionButton, SubmitButton } from "./submit-button";
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

describe("SubmitButton", () => {
  it("renders children, enabled, when not pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: false, data: null, method: null, action: null });
    render(<SubmitButton className="btn-primary" pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("btn-primary");
  });

  it("swaps to the pending label and disables while pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: new FormData(), method: "POST", action: "/" });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
  });

  it("falls back to children as the pending label when none is given", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: new FormData(), method: "POST", action: "/" });
    render(<SubmitButton>Save</SubmitButton>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("FormActionButton", () => {
  it("shows the pending label only on the button whose name/value was submitted, disables both", () => {
    const data = new FormData();
    data.set("decision", "approved");
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data, method: "POST", action: "/" });
    render(
      <>
        <FormActionButton name="decision" value="approved" pendingLabel="Approving…">Approve</FormActionButton>
        <FormActionButton name="decision" value="rejected" pendingLabel="Rejecting…">Reject</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(rejectButton).toBeDisabled();
  });

  it("shows plain children on both buttons when not pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: false, data: null, method: null, action: null });
    render(
      <>
        <FormActionButton name="decision" value="approved">Approve</FormActionButton>
        <FormActionButton name="decision" value="rejected">Reject</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
  });

  it("matches by formAction reference when name/value are not provided", () => {
    const saveAction = vi.fn();
    const hideAction = vi.fn();
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: new FormData(), method: "POST", action: saveAction });
    render(
      <>
        <FormActionButton formAction={saveAction} pendingLabel="Saving…">Save</FormActionButton>
        <FormActionButton formAction={hideAction} pendingLabel="Hiding…">Hide</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toBeDisabled();
  });
});
