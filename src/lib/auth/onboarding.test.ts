import { describe, expect, it } from "vitest";

import {
  evaluateOnboarding,
  normalizePhoneNumber,
  normalizeShopSlug,
  parseAccountSetup,
  parseSettlementInput,
  parseShopIdentity,
  type OnboardingFacts,
} from "./onboarding";

const completeFacts: OnboardingFacts = {
  seller: {
    country: "GH",
    contactName: "Ama Mensah",
    contactEmail: "ama@example.com",
    contactPhone: "+233241234567",
  },
  shop: {
    displayName: "Ama Market",
    slug: "ama-market",
    legalName: "Ama Market Limited",
    registrationNumber: "CS123456",
    status: "draft",
  },
  policyAccepted: true,
  verificationState: "verified",
  paymentSubaccountActive: true,
};

describe("evaluateOnboarding", () => {
  it("keeps milestones in the required order and resumes at account", () => {
    const state = evaluateOnboarding(
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
    );

    expect(state.milestones.map(({ key }) => key)).toEqual([
      "account",
      "shop_identity",
      "first_product",
      "fulfillment",
      "payment",
      "preview_publish",
    ]);
    expect(state.nextMilestone).toBe("account");
  });

  it("uses explicit unavailable adapters for catalog and fulfillment", () => {
    const state = evaluateOnboarding(completeFacts, {
      firstProduct: { available: false, complete: false },
      fulfillment: { available: false, complete: false },
    });

    expect(state.nextMilestone).toBe("first_product");
    expect(state.milestones[2]).toMatchObject({
      key: "first_product",
      complete: false,
      available: false,
    });
    expect(state.milestones[3]).toMatchObject({
      key: "fulfillment",
      complete: false,
      available: false,
    });
    expect(state.previewEnabled).toBe(false);
  });

  it("resumes at the first incomplete required persisted fact", () => {
    const state = evaluateOnboarding(
      {
        ...completeFacts,
        paymentSubaccountActive: false,
      },
      {
        firstProduct: { available: true, complete: true },
        fulfillment: { available: true, complete: true },
      },
    );

    expect(state.nextMilestone).toBe("payment");
    expect(state.milestones.find(({ key }) => key === "payment")?.complete).toBe(
      false,
    );
    expect(
      state.milestones.find(({ key }) => key === "preview_publish")?.available,
    ).toBe(false);
    expect(state.previewEnabled).toBe(false);
  });

  it("does not mark preview and publish complete for a draft shop", () => {
    const state = evaluateOnboarding(completeFacts, {
      firstProduct: { available: true, complete: true },
      fulfillment: { available: true, complete: true },
    });

    expect(state.nextMilestone).toBe("preview_publish");
    expect(state.previewEnabled).toBe(true);
    expect(state.milestones.at(-1)?.complete).toBe(false);
  });
});

describe("onboarding input normalization", () => {
  it("normalizes Ghana and Nigeria phone numbers to E.164 basics", () => {
    expect(normalizePhoneNumber("024 123 4567", "GH")).toBe("+233241234567");
    expect(normalizePhoneNumber("(080) 1234-5678", "NG")).toBe(
      "+2348012345678",
    );
  });

  it("normalizes shop slugs to lowercase hyphen form", () => {
    expect(normalizeShopSlug("  Ama's Fresh SHOP  ")).toBe("ama-s-fresh-shop");
  });

  it("uses the verified auth email instead of trusting a submitted email", () => {
    const result = parseAccountSetup(
      {
        country: "GH",
        contactName: " Ama Mensah ",
        contactPhone: "024 123 4567",
      },
      "Verified@Example.com",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        country: "GH",
        contactName: "Ama Mensah",
        contactEmail: "verified@example.com",
        contactPhone: "+233241234567",
      });
    }
  });

  it("rejects invalid identity input with field errors", () => {
    const result = parseShopIdentity({
      displayName: "",
      slug: "---",
      legalName: "",
      registrationNumber: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toMatchObject({
        displayName: expect.any(Array),
        slug: expect.any(Array),
        legalName: expect.any(Array),
      });
    }
  });

  it("validates a draft shop without requiring policy acceptance", () => {
    const result = parseShopIdentity({
      displayName: "Ama Market",
      slug: "Ama Market",
      legalName: "Ama Market Limited",
      registrationNumber: "",
    });

    expect(result).toEqual({
      success: true,
      data: {
        displayName: "Ama Market",
        slug: "ama-market",
        legalName: "Ama Market Limited",
        registrationNumber: null,
      },
    });
  });

  it("validates settlement input while keeping the account number transient", () => {
    const result = parseSettlementInput({
      bankCode: " GH001 ",
      bankName: " Example Bank ",
      accountNumber: "0123 456 789",
    });

    expect(result).toEqual({
      success: true,
      data: {
        bankCode: "GH001",
        bankName: "Example Bank",
        accountNumber: "0123456789",
        accountLast4: "6789",
      },
    });
  });
});
