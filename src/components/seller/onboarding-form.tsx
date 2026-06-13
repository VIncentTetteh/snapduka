"use client";

import { useActionState } from "react";
import Link from "next/link";

import {
  bootstrapSellerAction,
  requestSettlementAction,
  saveAccountAction,
  saveShopAction,
  type OnboardingActionState,
} from "@/app/(seller)/onboarding/actions";
import type {
  OnboardingState,
  VerificationState,
} from "@/lib/auth/onboarding";

const initialActionState: OnboardingActionState = {
  status: "idle",
  values: {},
};

const milestoneLabels = {
  account: "Account and contact",
  shop_identity: "Shop identity and policy",
  first_product: "First product",
  fulfillment: "Fulfillment",
  payment: "Online payments",
  preview_publish: "Preview and publish",
} as const;

export type OnboardingFormModel = {
  mode: "bootstrap" | "seller";
  verifiedEmail: string | null;
  account: {
    country: "GH" | "NG";
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  } | null;
  shop: {
    displayName: string;
    slug: string;
    legalName: string | null;
    registrationNumber: string | null;
  } | null;
  settlement: {
    bankCode: string;
    bankName: string;
    accountLast4: string;
    status: "pending" | "active";
  } | null;
  policyAccepted: boolean;
  verificationState: VerificationState;
  onboarding: OnboardingState;
};

function fieldError(
  state: OnboardingActionState,
  field: string,
): string | undefined {
  return state.fieldErrors?.[field]?.[0];
}

function FormNotice({ state }: { state: OnboardingActionState }) {
  if (!state.message) {
    return null;
  }

  return (
    <p
      className={`rounded-xl border p-3 text-sm ${
        state.status === "error"
          ? "border-red-700 bg-red-50 text-red-900"
          : state.status === "processing"
            ? "border-amber-700 bg-amber-50 text-amber-950"
          : "border-emerald-700 bg-emerald-50 text-emerald-950"
      }`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function InputError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  return message ? (
    <p className="m-0 text-sm text-red-800" id={id}>
      {message}
    </p>
  ) : null;
}

function verificationMessage(state: VerificationState): string {
  const messages: Record<VerificationState, string> = {
    not_started:
      "Verification has not started. Settlement can be saved, but online payments stay blocked.",
    in_progress:
      "Verification is in progress. Online payments stay blocked until it is verified.",
    needs_action:
      "Verification needs action before online payments can be enabled.",
    verified: "Verification is complete. Eligible settlement can be activated.",
    rejected:
      "Verification was rejected. Resolve it before online payments can be enabled.",
    suspended:
      "Verification is suspended. Online payments cannot be enabled.",
  };

  return messages[state];
}

export function OnboardingForm({ model }: { model: OnboardingFormModel }) {
  const [accountState, accountAction, accountPending] = useActionState(
    model.mode === "bootstrap" ? bootstrapSellerAction : saveAccountAction,
    initialActionState,
  );
  const [shopState, shopAction, shopPending] = useActionState(
    saveShopAction,
    initialActionState,
  );
  const [settlementState, settlementAction, settlementPending] = useActionState(
    requestSettlementAction,
    initialActionState,
  );
  const nextLabel = model.onboarding.nextMilestone
    ? milestoneLabels[model.onboarding.nextMilestone]
    : "Setup complete";
  const controlClass =
    "min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base text-stone-950";
  const cardClass =
    "grid gap-3 rounded-2xl border border-stone-300 bg-white/90 p-4 shadow-sm";

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-3 py-5 pb-16">
      <header className="grid gap-2">
        <p className="m-0 text-xs font-extrabold uppercase tracking-widest text-emerald-900">
          Seller setup
        </p>
        <h1 className="m-0 max-w-3xl text-4xl font-black leading-none tracking-tight sm:text-6xl">
          Finish setting up your shop
        </h1>
        <p className="m-0 max-w-2xl text-stone-600">
          Your progress is saved from verified database records. Next step:{" "}
          <strong>{nextLabel}</strong>.
        </p>
      </header>

      <section aria-labelledby="checklist-heading" className={cardClass}>
        <h2 className="m-0 text-xl font-extrabold" id="checklist-heading">
          Setup checklist
        </h2>
        <ol className="m-0 grid list-none gap-2 p-0">
          {model.onboarding.milestones.map((milestone) => (
            <li
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-stone-50 px-3"
              key={milestone.key}
            >
              <span>{milestoneLabels[milestone.key]}</span>
              <strong className="text-sm">
                {milestone.complete
                  ? "Complete"
                  : milestone.available
                    ? "Next"
                    : "Not available yet"}
              </strong>
            </li>
          ))}
        </ol>
        {model.onboarding.milestones[2]?.available &&
        !model.onboarding.milestones[2]?.complete ? (
          <p className="m-0 text-sm text-stone-600">
            <Link className="font-bold text-emerald-900 underline" href="/dashboard/products">
              Add your first product
            </Link>{" "}
            to continue setup.
          </p>
        ) : null}
        {model.onboarding.milestones[3]?.available &&
        !model.onboarding.milestones[3]?.complete ? (
          <p className="m-0 text-sm text-stone-600">
            <Link className="font-bold text-emerald-900 underline" href="/dashboard/settings/fulfillment">
              Add delivery or pickup
            </Link>{" "}
            to tell buyers how they can receive orders.
          </p>
        ) : null}
      </section>

      <form
        action={accountAction}
        aria-labelledby="account-heading"
        className={cardClass}
      >
        <h2 className="m-0 text-xl font-extrabold" id="account-heading">
          1. Account and contact
        </h2>

        <label className="font-bold" htmlFor="country">
          Country
        </label>
        <select
          aria-describedby={
            fieldError(accountState, "country") ? "country-error" : undefined
          }
          className={controlClass}
          defaultValue={
            accountState.values.country ?? model.account?.country ?? "GH"
          }
          disabled={model.mode === "seller"}
          id="country"
          name="country"
        >
          <option value="GH">Ghana</option>
          <option value="NG">Nigeria</option>
        </select>
        {model.mode === "seller" ? (
          <input
            name="country"
            type="hidden"
            value={model.account?.country ?? "GH"}
          />
        ) : null}
        <InputError
          id="country-error"
          message={fieldError(accountState, "country")}
        />

        <label className="font-bold" htmlFor="contact-name">
          Contact name
        </label>
        <input
          aria-describedby={
            fieldError(accountState, "contactName")
              ? "contact-name-error"
              : undefined
          }
          autoComplete="name"
          className={controlClass}
          defaultValue={
            accountState.values.contactName ??
            model.account?.contactName ??
            ""
          }
          id="contact-name"
          name="contactName"
          required
        />
        <InputError
          id="contact-name-error"
          message={fieldError(accountState, "contactName")}
        />

        <label className="font-bold" htmlFor="contact-email">
          Contact email
        </label>
        <input
          className={`${controlClass} bg-stone-100`}
          id="contact-email"
          readOnly
          type="email"
          value={model.verifiedEmail ?? ""}
        />
        <p className="m-0 text-sm text-stone-600">
          This is taken from the verified signed-in account.
        </p>

        <label className="font-bold" htmlFor="contact-phone">
          Contact phone
        </label>
        <input
          aria-describedby={
            fieldError(accountState, "contactPhone")
              ? "contact-phone-error"
              : undefined
          }
          autoComplete="tel"
          className={controlClass}
          defaultValue={
            accountState.values.contactPhone ??
            model.account?.contactPhone ??
            ""
          }
          id="contact-phone"
          inputMode="tel"
          name="contactPhone"
          required
        />
        <InputError
          id="contact-phone-error"
          message={fieldError(accountState, "contactPhone")}
        />

        <FormNotice state={accountState} />
        <button
          className="min-h-11 rounded-full bg-emerald-800 px-5 font-extrabold text-white disabled:opacity-60"
          disabled={accountPending}
          type="submit"
        >
          {accountPending
            ? "Saving..."
            : model.mode === "bootstrap"
              ? "Create seller account"
              : "Save contact details"}
        </button>
      </form>

      {model.mode === "seller" ? (
        <>
          <form
            action={shopAction}
            aria-labelledby="shop-heading"
            className={cardClass}
          >
            <h2 className="m-0 text-xl font-extrabold" id="shop-heading">
              2. Shop identity and policy
            </h2>

            <label className="font-bold" htmlFor="display-name">
              Shop display name
            </label>
            <input
              aria-describedby={
                fieldError(shopState, "displayName")
                  ? "display-name-error"
                  : undefined
              }
              className={controlClass}
              defaultValue={
                shopState.values.displayName ?? model.shop?.displayName ?? ""
              }
              id="display-name"
              name="displayName"
              required
            />
            <InputError
              id="display-name-error"
              message={fieldError(shopState, "displayName")}
            />

            <label className="font-bold" htmlFor="shop-slug">
              Shop address
            </label>
            <input
              aria-describedby={
                fieldError(shopState, "slug") ? "shop-slug-error" : undefined
              }
              autoCapitalize="none"
              className={controlClass}
              defaultValue={shopState.values.slug ?? model.shop?.slug ?? ""}
              id="shop-slug"
              name="slug"
              placeholder="ama-market"
              required
            />
            <InputError
              id="shop-slug-error"
              message={fieldError(shopState, "slug")}
            />

            <label className="font-bold" htmlFor="legal-name">
              Registered business name
            </label>
            <input
              aria-describedby={
                fieldError(shopState, "legalName")
                  ? "legal-name-error"
                  : undefined
              }
              className={controlClass}
              defaultValue={
                shopState.values.legalName ?? model.shop?.legalName ?? ""
              }
              id="legal-name"
              name="legalName"
              required
            />
            <InputError
              id="legal-name-error"
              message={fieldError(shopState, "legalName")}
            />

            <label className="font-bold" htmlFor="registration-number">
              Registration number (optional)
            </label>
            <input
              className={controlClass}
              defaultValue={
                shopState.values.registrationNumber ??
                model.shop?.registrationNumber ??
                ""
              }
              id="registration-number"
              name="registrationNumber"
            />

            <label className="flex min-h-11 items-center gap-3 font-bold">
              <input
                aria-describedby={
                  fieldError(shopState, "policyAccepted")
                    ? "policy-error"
                    : undefined
                }
                className="h-5 w-5"
                defaultChecked={
                  shopState.values.policyAccepted === "on" ||
                  model.policyAccepted
                }
                name="policyAccepted"
                type="checkbox"
              />
              Accept the seller policy (required for publishing and payments)
            </label>
            <InputError
              id="policy-error"
              message={fieldError(shopState, "policyAccepted")}
            />
            <p className="m-0 text-sm text-stone-600">
              Contact verification and policy acceptance can support a basic
              shop later. Products and fulfillment are still required before
              preview and publish.
            </p>

            <FormNotice state={shopState} />
            <button
              className="min-h-11 rounded-full bg-emerald-800 px-5 font-extrabold text-white disabled:opacity-60"
              disabled={shopPending}
              type="submit"
            >
              {shopPending ? "Saving..." : "Save shop identity"}
            </button>
          </form>

          <form
            action={settlementAction}
            aria-labelledby="settlement-heading"
            className={cardClass}
          >
            <h2 className="m-0 text-xl font-extrabold" id="settlement-heading">
              3. Settlement eligibility
            </h2>
            <p className="m-0 text-sm text-stone-600">
              {verificationMessage(model.verificationState)}
            </p>

            <label className="font-bold" htmlFor="bank-code">
              Bank code
            </label>
            <input
              aria-describedby={
                fieldError(settlementState, "bankCode")
                  ? "bank-code-error"
                  : undefined
              }
              className={controlClass}
              defaultValue={
                settlementState.values.bankCode ??
                model.settlement?.bankCode ??
                ""
              }
              id="bank-code"
              name="bankCode"
              required
            />
            <InputError
              id="bank-code-error"
              message={fieldError(settlementState, "bankCode")}
            />

            <label className="font-bold" htmlFor="bank-name">
              Bank name
            </label>
            <input
              aria-describedby={
                fieldError(settlementState, "bankName")
                  ? "bank-name-error"
                  : undefined
              }
              className={controlClass}
              defaultValue={
                settlementState.values.bankName ??
                model.settlement?.bankName ??
                ""
              }
              id="bank-name"
              name="bankName"
              required
            />
            <InputError
              id="bank-name-error"
              message={fieldError(settlementState, "bankName")}
            />

            <label className="font-bold" htmlFor="account-number">
              Bank account number
            </label>
            <input
              aria-describedby="account-number-help account-number-error"
              autoComplete="off"
              className={controlClass}
              defaultValue={settlementState.values.accountNumber ?? ""}
              id="account-number"
              inputMode="numeric"
              name="accountNumber"
              required
            />
            <p className="m-0 text-sm text-stone-600" id="account-number-help">
              The full number is sent only during this request and is never
              stored.{" "}
              {model.settlement
                ? `Saved settlement ends in ${model.settlement.accountLast4}.`
                : ""}
            </p>
            <InputError
              id="account-number-error"
              message={fieldError(settlementState, "accountNumber")}
            />

            <FormNotice state={settlementState} />
            <button
              className="min-h-11 rounded-full bg-emerald-800 px-5 font-extrabold text-white disabled:opacity-60"
              disabled={settlementPending}
              type="submit"
            >
              {settlementPending
                ? "Saving..."
                : "Save settlement and check eligibility"}
            </button>
          </form>

          <section aria-labelledby="preview-heading" className={cardClass}>
            <h2 className="m-0 text-xl font-extrabold" id="preview-heading">
              Preview
            </h2>
            <p className="m-0 text-sm text-stone-600">
              Preview stays disabled until account, identity, first product,
              fulfillment, and active online payments are persisted.
            </p>
            <button
              aria-disabled="true"
              className="min-h-11 rounded-full border border-stone-400 bg-stone-100 px-5 font-extrabold text-stone-500"
              disabled
              type="button"
            >
              Preview shop
            </button>
          </section>
        </>
      ) : null}
    </main>
  );
}
