import { redirect } from "next/navigation";

import { OnboardingForm, type OnboardingFormModel } from "@/components/seller/onboarding-form";
import { resolveServerActor, type SellerActor } from "@/lib/auth/actor";
import {
  evaluateOnboarding,
  type OnboardingFacts,
  type VerificationState,
} from "@/lib/auth/onboarding";
import { createClient } from "@/lib/supabase/server";

const SELLER_POLICY_KEY = "seller_terms";
const SELLER_POLICY_VERSION = "2026-06-12";

export const dynamic = "force-dynamic";

function statePage(title: string, message: string) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-2xl content-center gap-4 px-3 py-10">
      <p className="m-0 text-xs font-extrabold uppercase tracking-widest text-emerald-900">
        Seller setup
      </p>
      <h1 className="m-0 text-4xl font-black leading-none tracking-tight sm:text-6xl">
        {title}
      </h1>
      <p className="m-0 text-stone-600">{message}</p>
    </main>
  );
}

async function sellerModel(actor: SellerActor): Promise<OnboardingFormModel> {
  const supabase = await createClient();
  const [
    sellerResult,
    shopResult,
    policyResult,
    verificationResult,
    paymentResult,
    settlementResult,
    productResult,
    fulfillmentResult,
  ] = await Promise.all([
    supabase
      .from("seller_accounts")
      .select("country, contact_name, contact_email, contact_phone")
      .eq("id", actor.sellerAccountId)
      .single(),
    supabase
      .from("shops")
      .select(
        "display_name, slug, legal_name, registration_number, status",
      )
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("policy_acceptances")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("policy_key", SELLER_POLICY_KEY)
      .eq("policy_version", SELLER_POLICY_VERSION)
      .maybeSingle(),
    supabase
      .from("seller_verifications")
      .select("state")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("payment_subaccounts")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("provider", "paystack")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("settlement_profiles")
      .select("bank_code, bank_name, account_last4, status")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("provider", "paystack")
      .maybeSingle(),
    supabase
      .from("products")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .neq("status", "archived")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("fulfillment_methods")
      .select("id")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);
  const loadError =
    sellerResult.error ??
    shopResult.error ??
    policyResult.error ??
    verificationResult.error ??
    paymentResult.error ??
    settlementResult.error ??
    productResult.error ??
    fulfillmentResult.error;

  if (loadError) {
    throw new Error("Unable to load seller onboarding.", {
      cause: loadError,
    });
  }

  const seller = sellerResult.data;

  if (!seller) {
    throw new Error("Unable to load the seller account.");
  }

  const shop = shopResult.data;
  const verificationState =
    (verificationResult.data?.state as VerificationState | undefined) ??
    "not_started";
  const facts: OnboardingFacts = {
    seller: {
      country: seller.country,
      contactName: seller.contact_name,
      contactEmail: seller.contact_email,
      contactPhone: seller.contact_phone,
    },
    shop: shop
      ? {
          displayName: shop.display_name,
          slug: shop.slug,
          legalName: shop.legal_name,
          registrationNumber: shop.registration_number,
          status: shop.status,
        }
      : null,
    policyAccepted: Boolean(policyResult.data),
    verificationState,
    paymentSubaccountActive: Boolean(paymentResult.data),
  };

  return {
    mode: "seller",
    verifiedEmail: actor.email,
    account: facts.seller,
    shop: shop
      ? {
          displayName: shop.display_name,
          slug: shop.slug,
          legalName: shop.legal_name,
          registrationNumber: shop.registration_number,
        }
      : null,
    settlement: settlementResult.data
      ? {
          bankCode: settlementResult.data.bank_code,
          bankName: settlementResult.data.bank_name,
          accountLast4: settlementResult.data.account_last4,
          status: settlementResult.data.status,
        }
      : null,
    policyAccepted: facts.policyAccepted,
    verificationState,
    onboarding: evaluateOnboarding(facts, {
      firstProduct: { available: true, complete: Boolean(productResult.data) },
      fulfillment: {
        available: true,
        complete: Boolean(fulfillmentResult.data),
      },
    }),
  };
}

export default async function OnboardingPage() {
  const actor = await resolveServerActor();

  if (actor.kind === "anonymous") {
    redirect(`/login?${new URLSearchParams({ next: "/onboarding" })}`);
  }

  if (actor.kind === "operator") {
    return statePage(
      "Seller onboarding unavailable",
      "Operator accounts can review seller records but cannot become a seller through this flow.",
    );
  }

  if (actor.kind === "seller" && actor.status === "suspended") {
    return statePage(
      "Account needs resolution",
      "Onboarding is read-only while this seller account is suspended. Resolve the account status before continuing.",
    );
  }

  if (actor.kind === "seller" && actor.status === "closed") {
    return statePage(
      "Seller account closed",
      "This seller account cannot continue onboarding.",
    );
  }

  if (actor.kind === "unprovisioned") {
    const facts: OnboardingFacts = {
      seller: null,
      shop: null,
      policyAccepted: false,
      verificationState: "not_started",
      paymentSubaccountActive: false,
    };

    return (
      <OnboardingForm
        model={{
          mode: "bootstrap",
          verifiedEmail: actor.email,
          account: null,
          shop: null,
          settlement: null,
          policyAccepted: false,
          verificationState: "not_started",
          onboarding: evaluateOnboarding(facts, {
            firstProduct: { available: false, complete: false },
            fulfillment: { available: false, complete: false },
          }),
        }}
      />
    );
  }

  return <OnboardingForm model={await sellerModel(actor)} />;
}
