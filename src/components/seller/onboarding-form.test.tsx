import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(seller)/onboarding/actions", () => ({
  bootstrapSellerAction: vi.fn(),
  requestSettlementAction: vi.fn(),
  saveAccountAction: vi.fn(),
  saveShopAction: vi.fn(),
}));

import { OnboardingForm } from "./onboarding-form";

describe("OnboardingForm", () => {
  it("renders mobile-accessible current steps and honest future blockers", () => {
    render(
      <OnboardingForm
        model={{
          mode: "seller",
          verifiedEmail: "seller@example.com",
          account: {
            country: "GH",
            contactName: "Ama Mensah",
            contactEmail: "seller@example.com",
            contactPhone: "+233241234567",
          },
          shop: {
            displayName: "Ama Market",
            slug: "ama-market",
            legalName: "Ama Market Limited",
            registrationNumber: "",
          },
          settlement: null,
          policyAccepted: true,
          verificationState: "in_progress",
          onboarding: {
            nextMilestone: "first_product",
            previewEnabled: false,
            milestones: [
              { key: "account", complete: true, available: true },
              { key: "shop_identity", complete: true, available: true },
              { key: "first_product", complete: false, available: false },
              { key: "fulfillment", complete: false, available: false },
              { key: "payment", complete: false, available: false },
              { key: "preview_publish", complete: false, available: false },
            ],
          },
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /finish setting up your shop/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/country/i)).toHaveValue("GH");
    expect(screen.getByLabelText(/contact email/i)).toHaveValue(
      "seller@example.com",
    );
    expect(screen.getByLabelText(/shop display name/i)).toHaveValue(
      "Ama Market",
    );
    expect(screen.getByLabelText(/accept the seller policy/i)).toBeChecked();
    expect(
      screen.queryByRole("link", { name: /add your first product/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/verification is in progress/i)).toBeInTheDocument();
    expect(
      screen.getByText(/active online payments are persisted/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview shop/i }),
    ).toBeDisabled();
  });
});
