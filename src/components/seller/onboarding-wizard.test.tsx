import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OnboardingWizard,
  type OnboardingWizardModel,
} from "./onboarding-wizard";
import { evaluateOnboarding } from "@/lib/auth/onboarding";

vi.mock("@/app/(seller)/onboarding/actions", () => ({
  bootstrapSellerAction: vi.fn(async () => ({ status: "success", values: {} })),
  saveAccountAction: vi.fn(async () => ({ status: "success", values: {} })),
  saveShopAction: vi.fn(async () => ({ status: "success", values: {} })),
  saveOnboardingFulfillmentAction: vi.fn(async () => ({ status: "success", values: {} })),
  publishShopAction: vi.fn(async () => ({ status: "success", values: {} })),
  requestSettlementAction: vi.fn(async () => ({ status: "processing", values: {} })),
}));

vi.mock("@/app/(seller)/dashboard/products/actions", () => ({
  createProductAction: vi.fn(async () => ({ status: "success", values: {} })),
}));

function bootstrapModel(): OnboardingWizardModel {
  return {
    mode: "bootstrap",
    verifiedEmail: "ama@example.com",
    account: null,
    shop: null,
    settlement: null,
    policyAccepted: false,
    verificationState: "not_started",
    productCount: 0,
    onboarding: evaluateOnboarding(
      {
        seller: null,
        shop: null,
        policyAccepted: false,
        verificationState: "not_started",
        paymentSubaccountActive: false,
      },
      {
        firstProduct: { available: false, complete: false },
        fulfillment: { available: false, complete: false },
      },
    ),
  };
}

describe("OnboardingWizard", () => {
  afterEach(cleanup);

  it("starts a new seller at step 1 with the live preview", () => {
    render(<OnboardingWizard model={bootstrapModel()} />);

    expect(
      screen.getByRole("heading", { name: /name your shop/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
    expect(screen.getByText(/your shop name/i)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /setup steps/i })).toBeInTheDocument();
  });

  it("blocks continuing without a shop name and advances once named", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard model={bootstrapModel()} />);

    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give your shop a name/i);

    await user.type(screen.getByPlaceholderText(/ama's closet/i), "Ama's Closet");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      screen.getByRole("heading", { name: /where do you sell/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ghana/i })).toBeInTheDocument();
  });

  it("auto-slugifies the shop name for the store link preview", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard model={bootstrapModel()} />);

    await user.type(screen.getByPlaceholderText(/ama's closet/i), "Ama's Closet");
    expect(screen.getByText(/live preview/i)).toHaveTextContent("ama-s-closet");
  });

  it("resumes a returning seller at their first incomplete step", () => {
    const model: OnboardingWizardModel = {
      ...bootstrapModel(),
      mode: "seller",
      account: {
        country: "GH",
        contactName: "Ama Serwaa",
        contactEmail: "ama@example.com",
        contactPhone: "+233240000000",
      },
      shop: {
        displayName: "Ama's Closet",
        slug: "amas-closet",
        legalName: "Ama's Closet",
        registrationNumber: null,
      },
      onboarding: evaluateOnboarding(
        {
          seller: {
            country: "GH",
            contactName: "Ama Serwaa",
            contactEmail: "ama@example.com",
            contactPhone: "+233240000000",
          },
          shop: {
            displayName: "Ama's Closet",
            slug: "amas-closet",
            legalName: "Ama's Closet",
            registrationNumber: null,
            status: "draft",
          },
          policyAccepted: true,
          verificationState: "not_started",
          paymentSubaccountActive: false,
        },
        {
          firstProduct: { available: true, complete: false },
          fulfillment: { available: true, complete: false },
        },
      ),
      policyAccepted: true,
    };

    render(<OnboardingWizard model={model} />);

    expect(
      screen.getByRole("heading", { name: /how do orders reach customers/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 5 of 8/i)).toBeInTheDocument();
  });
});
