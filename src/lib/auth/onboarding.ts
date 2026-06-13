import { z } from "zod";
import type { CountryCode } from "@/lib/countries/types";

export const onboardingMilestoneKeys = [
  "account",
  "shop_identity",
  "first_product",
  "fulfillment",
  "payment",
  "preview_publish",
] as const;

export type OnboardingMilestoneKey = (typeof onboardingMilestoneKeys)[number];
export type VerificationState =
  | "not_started"
  | "in_progress"
  | "needs_action"
  | "verified"
  | "rejected"
  | "suspended";

export type OnboardingFacts = {
  seller: {
    country: CountryCode;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  } | null;
  shop: {
    displayName: string;
    slug: string;
    legalName: string | null;
    registrationNumber: string | null;
    status: "draft" | "pending_review" | "published" | "suspended" | "closed";
  } | null;
  policyAccepted: boolean;
  verificationState: VerificationState;
  paymentSubaccountActive: boolean;
};

export type MilestoneDependencyResult = {
  available: boolean;
  complete: boolean;
};

export type OnboardingMilestoneDependencies = {
  firstProduct: MilestoneDependencyResult;
  fulfillment: MilestoneDependencyResult;
};

export type OnboardingMilestone = {
  key: OnboardingMilestoneKey;
  complete: boolean;
  available: boolean;
};

export type OnboardingState = {
  milestones: OnboardingMilestone[];
  nextMilestone: OnboardingMilestoneKey | null;
  previewEnabled: boolean;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function evaluateOnboarding(
  facts: OnboardingFacts,
  dependencies: OnboardingMilestoneDependencies,
): OnboardingState {
  const accountComplete =
    facts.seller !== null &&
    hasText(facts.seller.contactName) &&
    hasText(facts.seller.contactEmail) &&
    hasText(facts.seller.contactPhone);
  const shopIdentityComplete =
    facts.shop !== null &&
    hasText(facts.shop.displayName) &&
    slugPattern.test(facts.shop.slug) &&
    hasText(facts.shop.legalName) &&
    facts.policyAccepted;

  const milestones: OnboardingMilestone[] = [
    { key: "account", complete: accountComplete, available: true },
    {
      key: "shop_identity",
      complete: shopIdentityComplete,
      available: accountComplete,
    },
    {
      key: "first_product",
      complete: dependencies.firstProduct.complete,
      available: dependencies.firstProduct.available && shopIdentityComplete,
    },
    {
      key: "fulfillment",
      complete: dependencies.fulfillment.complete,
      available:
        dependencies.fulfillment.available &&
        dependencies.firstProduct.complete,
    },
    {
      key: "payment",
      complete: facts.paymentSubaccountActive,
      available: facts.verificationState === "verified",
    },
    {
      key: "preview_publish",
      complete: facts.shop?.status === "published",
      available:
        accountComplete &&
        shopIdentityComplete &&
        dependencies.firstProduct.complete &&
        dependencies.fulfillment.complete &&
        facts.paymentSubaccountActive,
    },
  ];

  return {
    milestones,
    nextMilestone:
      milestones.find((milestone) => !milestone.complete)?.key ?? null,
    previewEnabled:
      accountComplete &&
      shopIdentityComplete &&
      dependencies.firstProduct.complete &&
      dependencies.fulfillment.complete &&
      facts.paymentSubaccountActive,
  };
}

export function normalizePhoneNumber(
  input: string,
  country: CountryCode,
): string {
  const callingCode = country === "GH" ? "233" : country === "NG" ? "234" : "225";
  const stripped = input.trim().replace(/[^\d+]/g, "");
  const digits = stripped.replace(/\D/g, "");

  if (stripped.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.startsWith(callingCode)) {
    return `+${digits}`;
  }

  return `+${callingCode}${country === "CI" ? digits : digits.replace(/^0/, "")}`;
}

export function normalizeShopSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const accountSetupSchema = z.object({
  country: z.enum(["GH", "NG", "CI"]),
  contactName: z.string().trim().min(2, "Enter your contact name."),
  contactEmail: z.email("Use the verified email on your account."),
  contactPhone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Enter a valid phone number."),
});

const shopIdentitySchema = z.object({
  displayName: z.string().trim().min(2, "Enter a shop display name."),
  slug: z
    .string()
    .regex(slugPattern, "Use lowercase letters, numbers, and hyphens."),
  legalName: z.string().trim().min(2, "Enter the registered business name."),
  registrationNumber: z.string().trim().max(100).nullable(),
});

const settlementInputSchema = z
  .object({
    bankCode: z.string().trim().min(1, "Enter the bank code."),
    bankName: z.string().trim().min(2, "Enter the bank name."),
    accountNumber: z
      .string()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(
        z
          .string()
          .min(6, "Enter a valid account number.")
          .max(20, "Enter a valid account number."),
      ),
  })
  .transform((value) => ({
    ...value,
    accountLast4: value.accountNumber.slice(-4),
  }));

export type FieldParseResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string[]> };

function fieldResult<T>(
  result: z.ZodSafeParseResult<T>,
): FieldParseResult<T> {
  if (result.success) {
    return result;
  }

  return {
    success: false,
    fieldErrors: Object.fromEntries(
      Object.entries(z.flattenError(result.error).fieldErrors).filter(
        (entry): entry is [string, string[]] => entry[1] !== undefined,
      ),
    ),
  };
}

export function parseAccountSetup(
  input: {
    country: string;
    contactName: string;
    contactPhone: string;
  },
  verifiedEmail: string | null,
): FieldParseResult<z.infer<typeof accountSetupSchema>> {
  return fieldResult(
    accountSetupSchema.safeParse({
      country: input.country,
      contactName: input.contactName,
      contactEmail: verifiedEmail?.trim().toLowerCase() ?? "",
      contactPhone:
        input.country === "GH" || input.country === "NG" || input.country === "CI"
          ? normalizePhoneNumber(input.contactPhone, input.country)
          : input.contactPhone,
    }),
  );
}

export function parseShopIdentity(input: {
  displayName: string;
  slug: string;
  legalName: string;
  registrationNumber: string;
}): FieldParseResult<z.infer<typeof shopIdentitySchema>> {
  return fieldResult(
    shopIdentitySchema.safeParse({
      displayName: input.displayName,
      slug: normalizeShopSlug(input.slug),
      legalName: input.legalName,
      registrationNumber: input.registrationNumber.trim() || null,
    }),
  );
}

export function parseSettlementInput(input: {
  bankCode: string;
  bankName: string;
  accountNumber: string;
}): FieldParseResult<z.infer<typeof settlementInputSchema>> {
  return fieldResult(settlementInputSchema.safeParse(input));
}
