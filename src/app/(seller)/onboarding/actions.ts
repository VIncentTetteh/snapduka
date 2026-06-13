"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import {
  parseAccountSetup,
  parseSettlementInput,
  parseShopIdentity,
} from "@/lib/auth/onboarding";
import {
  createPaymentSubaccount,
  type PaymentSubaccountProvider,
  type PaymentSubaccountRepository,
  type SafeSettlementMetadata,
} from "@/lib/payments/subaccounts";
import { mapPaymentActionResult } from "@/lib/payments/onboarding-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SELLER_POLICY_KEY = "seller_terms";
const SELLER_POLICY_VERSION = "2026-06-12";
const PAYSTACK_PERCENTAGE_CHARGE = 10;

export type OnboardingActionState = {
  status: "idle" | "success" | "processing" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values: Record<string, string>;
};

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function values(
  formData: FormData,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, formValue(formData, name)]));
}

function errorState(
  preservedValues: Record<string, string>,
  message: string,
  fieldErrors?: Record<string, string[]>,
): OnboardingActionState {
  return {
    status: "error",
    message,
    fieldErrors,
    values: preservedValues,
  };
}

function successState(
  message: string,
  preservedValues: Record<string, string> = {},
): OnboardingActionState {
  return {
    status: "success",
    message,
    values: preservedValues,
  };
}

function actorError(kind: "anonymous" | "operator" | "suspended") {
  switch (kind) {
    case "anonymous":
      return "Sign in again before saving onboarding.";
    case "operator":
      return "Operator accounts cannot complete seller onboarding.";
    case "suspended":
      return "This seller account is read-only until its status is resolved.";
  }
}

export async function bootstrapSellerAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const preserved = values(formData, [
    "country",
    "contactName",
    "contactPhone",
  ]);
  const actor = await resolveServerActor();

  if (actor.kind === "anonymous" || actor.kind === "operator") {
    return errorState(preserved, actorError(actor.kind));
  }

  if (actor.kind === "seller") {
    return errorState(
      preserved,
      actor.status === "suspended"
        ? actorError("suspended")
        : "A seller account already exists. Refresh to continue.",
    );
  }

  const parsed = parseAccountSetup(
    {
      country: preserved.country,
      contactName: preserved.contactName,
      contactPhone: preserved.contactPhone,
    },
    actor.email,
  );

  if (!parsed.success) {
    return errorState(
      preserved,
      "Check the highlighted account details.",
      parsed.fieldErrors,
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("bootstrap_seller_account", {
    p_auth_user_id: actor.userId,
    p_country: parsed.data.country,
    p_contact_name: parsed.data.contactName,
    p_contact_phone: parsed.data.contactPhone,
  });

  if (error) {
    return errorState(
      preserved,
      "We could not create the seller account. Please try again.",
    );
  }

  revalidatePath("/onboarding");
  return successState("Seller account created. Continue with your shop.");
}

export async function saveAccountAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const preserved = values(formData, [
    "country",
    "contactName",
    "contactPhone",
  ]);
  const actor = await resolveServerActor();

  if (actor.kind !== "seller") {
    return errorState(
      preserved,
      actorError(actor.kind === "operator" ? "operator" : "anonymous"),
    );
  }

  if (actor.status === "suspended" || actor.status === "closed") {
    return errorState(preserved, actorError("suspended"));
  }

  const parsed = parseAccountSetup(
    {
      country: preserved.country,
      contactName: preserved.contactName,
      contactPhone: preserved.contactPhone,
    },
    actor.email,
  );

  if (!parsed.success) {
    return errorState(
      preserved,
      "Check the highlighted account details.",
      parsed.fieldErrors,
    );
  }

  if (parsed.data.country !== actor.country) {
    return errorState(
      preserved,
      "Country cannot be changed after the seller account is created.",
      { country: ["Contact support to change the seller country."] },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("seller_accounts")
    .update({
      contact_name: parsed.data.contactName,
      contact_email: parsed.data.contactEmail,
      contact_phone: parsed.data.contactPhone,
    })
    .eq("id", actor.sellerAccountId);

  if (error) {
    return errorState(
      preserved,
      "We could not save the contact details. Please try again.",
    );
  }

  revalidatePath("/onboarding");
  return successState("Contact details saved.", preserved);
}

export async function saveShopAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const preserved = values(formData, [
    "displayName",
    "slug",
    "legalName",
    "registrationNumber",
    "policyAccepted",
  ]);
  const actor = await resolveServerActor();

  if (actor.kind !== "seller") {
    return errorState(
      preserved,
      actorError(actor.kind === "operator" ? "operator" : "anonymous"),
    );
  }

  if (actor.status === "suspended" || actor.status === "closed") {
    return errorState(preserved, actorError("suspended"));
  }

  const parsed = parseShopIdentity({
    displayName: preserved.displayName,
    slug: preserved.slug,
    legalName: preserved.legalName,
    registrationNumber: preserved.registrationNumber,
  });

  if (!parsed.success) {
    return errorState(
      preserved,
      "Check the highlighted shop details.",
      parsed.fieldErrors,
    );
  }

  const supabase = await createClient();
  const { error: shopError } = await supabase.rpc("save_onboarding_shop", {
    p_slug: parsed.data.slug,
    p_display_name: parsed.data.displayName,
    p_legal_name: parsed.data.legalName,
    p_registration_number: parsed.data.registrationNumber,
  });

  if (shopError) {
    const slugConflict =
      shopError.code === "23505" ||
      shopError.message.toLowerCase().includes("slug");

    return errorState(
      preserved,
      slugConflict
        ? "That shop address is already taken."
        : "We could not save the shop identity. Please try again.",
      slugConflict ? { slug: ["Choose a different shop address."] } : undefined,
    );
  }

  if (preserved.policyAccepted === "on") {
    const { error: policyError } = await supabase
      .from("policy_acceptances")
      .upsert(
        {
          seller_account_id: actor.sellerAccountId,
          policy_key: SELLER_POLICY_KEY,
          policy_version: SELLER_POLICY_VERSION,
        },
        {
          onConflict: "seller_account_id,policy_key,policy_version",
          ignoreDuplicates: true,
        },
      );

    if (policyError) {
      return errorState(
        { ...preserved, slug: parsed.data.slug },
        "Shop identity was saved, but policy acceptance could not be recorded.",
      );
    }
  }

  revalidatePath("/onboarding");
  return successState(
    preserved.policyAccepted === "on"
      ? "Shop identity and policy acceptance saved."
      : "Shop identity saved.",
    {
      ...preserved,
      slug: parsed.data.slug,
    },
  );
}

const unavailableProvider: PaymentSubaccountProvider = {
  async create() {
    throw new Error("Paystack provider is not configured in Foundation.");
  },
};

function paymentRepository(
  admin: ReturnType<typeof createAdminClient>,
): PaymentSubaccountRepository {
  return {
    async findActive(sellerAccountId) {
      const { data, error } = await admin
        .from("payment_subaccounts")
        .select("provider_subaccount_id, provider_subaccount_code")
        .eq("seller_account_id", sellerAccountId)
        .eq("provider", "paystack")
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        throw new Error("Unable to read payment setup.", { cause: error });
      }

      if (!data) {
        return null;
      }

      return {
        providerId: data.provider_subaccount_id,
        subaccountCode: data.provider_subaccount_code,
      };
    },
    async reserve({ authUserId, sellerAccountId, fingerprint, metadata }) {
      const { data, error } = await admin.rpc(
        "reserve_payment_subaccount_request",
        {
          p_auth_user_id: authUserId,
          p_seller_account_id: sellerAccountId,
          p_request_fingerprint: fingerprint,
          p_metadata: metadata,
        },
      );

      if (error) {
        const blockers = [
          ["ownership mismatch", "seller"],
          ["not eligible", "seller"],
          ["policy acceptance", "policy"],
          ["verified seller", "verification"],
          ["settlement profile", "profile"],
          ["shop identity", "shop"],
        ] as const;
        const blocker = blockers.find(([message]) =>
          error.message.toLowerCase().includes(message),
        )?.[1];

        if (blocker) {
          return { kind: "blocked", blocker };
        }

        throw new Error("Unable to reserve payment setup.", { cause: error });
      }

      const reservation = data?.[0];

      if (reservation?.reservation_status === "reserved") {
        return {
          kind: "reserved",
          reservationId: reservation.reservation_id,
        };
      }

      if (
        reservation?.reservation_status === "provider_created" &&
        reservation.provider_subaccount_id &&
        reservation.provider_subaccount_code &&
        reservation.provider_metadata
      ) {
        return {
          kind: "provider_created",
          reservationId: reservation.reservation_id,
          result: {
            providerId: reservation.provider_subaccount_id,
            subaccountCode: reservation.provider_subaccount_code,
            metadata: reservation.provider_metadata as SafeSettlementMetadata,
          },
        };
      }

      return { kind: "in_progress" };
    },
    async recordProviderResult({
      authUserId,
      sellerAccountId,
      reservationId,
      result,
    }) {
      const { error } = await admin.rpc(
        "record_payment_subaccount_provider_result",
        {
          p_auth_user_id: authUserId,
          p_seller_account_id: sellerAccountId,
          p_reservation_id: reservationId,
          p_provider_id: result.providerId,
          p_subaccount_code: result.subaccountCode,
          p_metadata: result.metadata,
        },
      );

      if (error) {
        throw new Error("Unable to record provider result.", { cause: error });
      }
    },
    async activate({
      authUserId,
      sellerAccountId,
      reservationId,
    }) {
      const { error } = await admin.rpc(
        "activate_payment_subaccount_request",
        {
          p_auth_user_id: authUserId,
          p_seller_account_id: sellerAccountId,
          p_reservation_id: reservationId,
        },
      );

      if (error) {
        throw new Error("Unable to activate payment setup.", { cause: error });
      }
    },
    async release(reservationId) {
      const { error } = await admin
        .from("payment_subaccounts")
        .delete()
        .eq("id", reservationId)
        .eq("status", "pending");

      if (error) {
        throw new Error("Unable to release payment setup.", { cause: error });
      }
    },
  };
}

export async function requestSettlementAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const preserved = values(formData, [
    "bankCode",
    "bankName",
    "accountNumber",
  ]);
  const actor = await resolveServerActor();

  if (actor.kind !== "seller") {
    return errorState(
      preserved,
      actorError(actor.kind === "operator" ? "operator" : "anonymous"),
    );
  }

  if (actor.status === "suspended" || actor.status === "closed") {
    return errorState(preserved, actorError("suspended"));
  }

  const parsed = parseSettlementInput({
    bankCode: preserved.bankCode,
    bankName: preserved.bankName,
    accountNumber: preserved.accountNumber,
  });

  if (!parsed.success) {
    return errorState(
      preserved,
      "Check the highlighted settlement details.",
      parsed.fieldErrors,
    );
  }

  const supabase = await createClient();
  const { data: existingProfile, error: profileReadError } = await supabase
    .from("settlement_profiles")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("provider", "paystack")
    .maybeSingle();

  if (profileReadError) {
    return errorState(
      preserved,
      "We could not read the settlement profile. Please try again.",
    );
  }

  const safeProfile = {
    bank_code: parsed.data.bankCode,
    bank_name: parsed.data.bankName,
    account_last4: parsed.data.accountLast4,
  };
  const profileResult = existingProfile
    ? await supabase
        .from("settlement_profiles")
        .update(safeProfile)
        .eq("id", existingProfile.id)
    : await supabase.from("settlement_profiles").insert({
        seller_account_id: actor.sellerAccountId,
        provider: "paystack",
        ...safeProfile,
      });

  if (profileResult.error) {
    return errorState(
      preserved,
      "We could not save the settlement details. Please try again.",
    );
  }

  const { data: shop, error: shopError } = await supabase
    .from("shops")
    .select("display_name, legal_name")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  if (shopError) {
    return errorState(
      { bankCode: parsed.data.bankCode, bankName: parsed.data.bankName },
      "Settlement details were saved, but eligibility could not be checked.",
    );
  }

  const paymentResult = await createPaymentSubaccount(
    {
      authUserId: actor.userId,
      sellerAccountId: actor.sellerAccountId,
      country: actor.country,
      businessName: shop?.legal_name ?? shop?.display_name ?? "",
      bankCode: parsed.data.bankCode,
      bankName: parsed.data.bankName,
      accountNumber: parsed.data.accountNumber,
      percentageCharge: PAYSTACK_PERCENTAGE_CHARGE,
    },
    {
      provider: unavailableProvider,
      repository: paymentRepository(createAdminClient()),
    },
  );
  const safeValues = {
    bankCode: parsed.data.bankCode,
    bankName: parsed.data.bankName,
  };

  revalidatePath("/onboarding");
  return {
    ...mapPaymentActionResult(paymentResult),
    values: safeValues,
  };
}
