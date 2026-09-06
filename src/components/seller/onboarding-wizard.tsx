"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { shortLinkUrl } from "@snapduka/core";

import {
  bootstrapSellerAction,
  publishShopAction,
  requestSettlementAction,
  saveAccountAction,
  saveOnboardingFulfillmentAction,
  saveShopAction,
  type OnboardingActionState,
} from "@/app/(seller)/onboarding/actions";
import { createProductAction } from "@/app/(seller)/dashboard/products/actions";
import { LogoMark } from "@/components/ui/logo";
import { Req } from "@/components/ui/required-mark";
import { normalizeShopSlug, type OnboardingState, type VerificationState } from "@/lib/auth/onboarding";
import type { CountryCode } from "@/lib/countries/types";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export type OnboardingWizardModel = {
  mode: "bootstrap" | "seller";
  verifiedEmail: string | null;
  account: {
    country: CountryCode;
    contactName: string;
    contactEmail: string | null;
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
  productCount: number;
  /**
   * The storefront's "other"-channel token, minted when the shop is published.
   * Null before publishing, and for a shop published before this existed.
   */
  shareToken: string | null;
  onboarding: OnboardingState;
};

const initialActionState: OnboardingActionState = { status: "idle", values: {} };

const STEP_LABELS = [
  "Shop",
  "Market",
  "Contact",
  "Link",
  "Delivery",
  "Product",
  "Payments",
  "Publish",
] as const;

const COUNTRY_INFO: Record<
  CountryCode,
  {
    name: string;
    cur: "GHS" | "NGN" | "XOF";
    sub: string;
    cityPlaceholder: string;
    phonePlaceholder: string;
    pricePlaceholder: string;
  }
> = {
  GH: {
    name: "Ghana",
    cur: "GHS",
    sub: "Paystack · mobile money & cards",
    cityPlaceholder: "e.g. Accra",
    phonePlaceholder: "+233 24 000 0000",
    pricePlaceholder: "e.g. 240.00",
  },
  NG: {
    name: "Nigeria",
    cur: "NGN",
    sub: "Paystack · transfers, cards & USSD",
    cityPlaceholder: "e.g. Lagos",
    phonePlaceholder: "+234 801 000 0000",
    pricePlaceholder: "e.g. 18500",
  },
  CI: {
    name: "Côte d'Ivoire",
    cur: "XOF",
    sub: "Offline payments at launch",
    cityPlaceholder: "e.g. Abidjan",
    phonePlaceholder: "+225 07 00 00 00 00",
    pricePlaceholder: "e.g. 12000",
  },
};

const FULFIL_OPTIONS = [
  {
    id: "rider" as const,
    label: "Rider / dispatch delivery",
    sub: "You arrange a rider per order (own dispatch, Bolt, Yango…)",
    type: "delivery" as const,
    name: "Rider delivery",
    instructions: "Rider / dispatch delivery",
  },
  {
    id: "pickup" as const,
    label: "Customer pickup",
    sub: "Buyers collect from your location or market stall",
    type: "pickup" as const,
    name: "Pickup",
    instructions: "Customer pickup",
  },
  {
    id: "courier" as const,
    label: "Courier / interstate shipping",
    sub: "For orders outside your city",
    type: "delivery" as const,
    name: "Courier / interstate",
    instructions: "Courier / interstate shipping",
  },
];

const INPUT =
  "h-[46px] w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";
const LABEL = "grid gap-1.5 text-[12.5px] font-semibold text-ink";

function configuredOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://snapduka.shop";
}

function subscribeNever(): () => void {
  return () => {};
}

function toMinorUnits(price: string, currency: "GHS" | "NGN" | "XOF"): string {
  const value = Number.parseFloat(price);
  if (!Number.isFinite(value)) return "";
  return String(Math.round(currency === "XOF" ? value : value * 100));
}

function CheckIcon({ size = 11, stroke = "currentColor" }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3.5 9.5 7 13l7.5-8" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2 className="mb-1.5 font-serif text-[22px] font-medium text-ink">{title}</h2>
      <p className="mb-5 text-[13.5px] leading-[1.6] text-ink-soft">{sub}</p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Wizard                                                              */
/* ------------------------------------------------------------------ */

export function OnboardingWizard({ model }: { model: OnboardingWizardModel }) {
  const milestones = model.onboarding.milestones;
  const milestone = (key: string) => milestones.find((m) => m.key === key);
  const accountComplete = Boolean(milestone("account")?.complete);
  const shopComplete = Boolean(model.shop);
  const productComplete = Boolean(milestone("first_product")?.complete);
  const fulfillmentComplete = Boolean(milestone("fulfillment")?.complete);
  const paymentComplete = Boolean(milestone("payment")?.complete);
  const alreadyPublished = Boolean(milestone("preview_publish")?.complete);

  const initialStep = alreadyPublished
    ? 8
    : !accountComplete || !shopComplete
      ? 1
      : !fulfillmentComplete
        ? 5
        : !productComplete
          ? 6
          : !paymentComplete
            ? 7
            : 8;

  // form state
  const [step, setStep] = useState(initialStep);
  const [maxStepReached, setMaxStepReached] = useState(initialStep);
  const [shopName, setShopName] = useState(model.shop?.displayName ?? "");
  const [shopDesc, setShopDesc] = useState("");
  const [country, setCountry] = useState<CountryCode>(model.account?.country ?? "GH");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState(model.account?.contactName ?? "");
  const [whatsapp, setWhatsapp] = useState(model.account?.contactPhone ?? "");
  const [slugInput, setSlugInput] = useState(model.shop?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(model.shop?.slug));
  const [fulfil, setFulfil] = useState({ rider: true, pickup: false, courier: false });
  const [fulfilFees, setFulfilFees] = useState<Record<string, string>>({ rider: "", pickup: "", courier: "" });
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodStock, setProdStock] = useState("");
  const [prodSkipped, setProdSkipped] = useState(productComplete);
  const [bankCode, setBankCode] = useState(model.settlement?.bankCode ?? "");
  const [bankName, setBankName] = useState(model.settlement?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(model.policyAccepted);

  // progress bookkeeping
  const [accountSaved, setAccountSaved] = useState(accountComplete);
  const [shopSaved, setShopSaved] = useState(shopComplete);
  const [savedFulfil, setSavedFulfil] = useState<Set<string>>(
    () => new Set(fulfillmentComplete ? FULFIL_OPTIONS.map((f) => f.id) : []),
  );
  const [productSaved, setProductSaved] = useState(productComplete);
  const [paymentState, setPaymentState] = useState<OnboardingActionState | null>(null);
  const [published, setPublished] = useState(alreadyPublished);

  const [stepError, setStepError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, startTransition] = useTransition();

  const info = COUNTRY_INFO[country];
  const countryLocked = model.mode === "seller" || accountSaved;
  const slug = slugEdited ? slugInput : normalizeShopSlug(shopName) || "your-shop";
  const anyFulfil = fulfil.rider || fulfil.pickup || fulfil.courier;
  // Server render uses the configured origin; after hydration the real
  // browser origin wins so links stay correct when dev ports shift.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    configuredOrigin,
  );
  const host = new URL(origin).host;
  const isCI = country === "CI";

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  function goTo(next: number) {
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
    setStepError(null);
    setFieldErrors({});
  }

  function fail(state: OnboardingActionState) {
    setStepError(state.message ?? "Something went wrong. Please try again.");
    setFieldErrors(state.fieldErrors ?? {});
  }

  /* ---------------- step transitions (wired to server actions) ----- */

  function continueFromStep() {
    setStepError(null);
    setFieldErrors({});

    switch (step) {
      case 1: {
        if (shopName.trim().length < 2) {
          setStepError("Give your shop a name (at least 2 characters).");
          return;
        }
        goTo(2);
        return;
      }
      case 2: {
        if (city.trim().length < 2) {
          setStepError("Enter your city so buyers know where you deliver from.");
          return;
        }
        goTo(3);
        return;
      }
      case 3: {
        if (contactName.trim().length < 2) {
          setStepError("Enter your name (at least 2 characters).");
          return;
        }
        if (whatsapp.trim().length < 8) {
          setStepError("Enter a valid WhatsApp number.");
          return;
        }
        startTransition(async () => {
          const fd = new FormData();
          fd.set("country", country);
          fd.set("contactName", contactName);
          fd.set("contactPhone", whatsapp);
          const action =
            model.mode === "bootstrap" && !accountSaved
              ? bootstrapSellerAction
              : saveAccountAction;
          const result = await action(initialActionState, fd);
          if (result.status === "error") {
            fail(result);
            return;
          }
          setAccountSaved(true);
          goTo(4);
        });
        return;
      }
      case 4: {
        if (slug.length < 3) {
          setStepError("Your store link needs at least 3 characters.");
          return;
        }
        startTransition(async () => {
          const fd = new FormData();
          fd.set("displayName", shopName);
          fd.set("slug", slug);
          fd.set("legalName", shopName);
          fd.set("registrationNumber", "");
          if (model.policyAccepted) fd.set("policyAccepted", "on");
          const result = await saveShopAction(initialActionState, fd);
          if (result.status === "error") {
            fail(result);
            return;
          }
          setShopSaved(true);
          goTo(5);
        });
        return;
      }
      case 5: {
        if (!anyFulfil) {
          setStepError("Pick at least one delivery method.");
          return;
        }
        const pending = FULFIL_OPTIONS.filter(
          (f) => fulfil[f.id] && !savedFulfil.has(f.id),
        );
        if (pending.length === 0) {
          goTo(6);
          return;
        }
        startTransition(async () => {
          for (const option of pending) {
            const fee = fulfilFees[option.id]?.trim();
            const feeMinor = Number.parseInt(fee ? toMinorUnits(fee, info.cur) : "0", 10);
            const fd = new FormData();
            fd.set("type", option.type);
            fd.set("name", option.name);
            fd.set("feeMinor", String(Number.isFinite(feeMinor) ? Math.max(0, feeMinor) : 0));
            fd.set("instructions", option.instructions);
            const result = await saveOnboardingFulfillmentAction(initialActionState, fd);
            if (result.status === "error") {
              fail(result);
              return;
            }
            setSavedFulfil((prev) => new Set(prev).add(option.id));
          }
          goTo(6);
        });
        return;
      }
      case 6: {
        if (productSaved || prodSkipped) {
          goTo(7);
          return;
        }
        if (prodName.trim().length < 2 || prodPrice.trim().length === 0) {
          setStepError("Add a product name and price, or skip for now.");
          return;
        }
        const priceMinor = toMinorUnits(prodPrice, info.cur);
        if (!priceMinor) {
          setStepError("Enter a valid price.");
          return;
        }
        startTransition(async () => {
          const fd = new FormData();
          fd.set("name", prodName);
          fd.set("price", priceMinor);
          fd.set("currency", info.cur);
          fd.set("status", "active");
          fd.set("inventoryPolicy", "track");
          fd.set("stockQuantity", prodStock.trim());
          const result = await createProductAction(
            { status: "idle", values: {} },
            fd,
          );
          if (result.status === "error") {
            fail(result as OnboardingActionState);
            return;
          }
          setProductSaved(true);
          goTo(7);
        });
        return;
      }
      case 7: {
        goTo(8);
        return;
      }
      case 8: {
        if (!policyAccepted) {
          setStepError("Accept the seller policy to publish your store.");
          return;
        }
        startTransition(async () => {
          const fd = new FormData();
          fd.set("displayName", shopName);
          fd.set("slug", slug);
          fd.set("legalName", shopName);
          fd.set("registrationNumber", "");
          fd.set("policyAccepted", "on");
          const shopResult = await saveShopAction(initialActionState, fd);
          if (shopResult.status === "error") {
            fail(shopResult);
            return;
          }
          const publishResult = await publishShopAction(
            initialActionState,
            new FormData(),
          );
          // publishShopAction redirects to /dashboard on success; an
          // OnboardingActionState return always means failure.
          if (publishResult?.status === "error") {
            fail(publishResult);
            return;
          }
          setPublished(true);
        });
        return;
      }
    }
  }

  function connectPaystack() {
    if (accountNumber.trim().length < 6 || !bankCode.trim() || bankName.trim().length < 2) {
      setStepError("Enter your bank or MoMo details to connect payouts.");
      return;
    }
    setStepError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("bankCode", bankCode);
      fd.set("bankName", bankName);
      fd.set("accountNumber", accountNumber);
      const result = await requestSettlementAction(initialActionState, fd);
      setPaymentState(result);
      if (result.status === "error") {
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  /* ---------------- derived display ---------------- */

  const fulfilSummary =
    FULFIL_OPTIONS.filter((f) => fulfil[f.id])
      .map((f) => f.label.split(" /")[0])
      .join(", ") || "—";

  const settlementSaved = Boolean(model.settlement) || paymentState?.status === "success" || paymentState?.status === "processing";
  const paymentsSummary = paymentComplete
    ? "Paystack connected"
    : isCI
      ? "Offline payments"
      : settlementSaved
        ? "Details saved — verification pending"
        : "Not connected";

  const reviewRows = [
    { label: "Shop", value: shopName || "—" },
    { label: "Market", value: `${info.name} · ${info.cur}` },
    { label: "City", value: city || "—" },
    { label: "WhatsApp", value: whatsapp || "—" },
    { label: "Store link", value: `${host}/${slug}` },
    { label: "Delivery", value: fulfilSummary },
    {
      label: "First product",
      value: productSaved
        ? prodName
          ? `${prodName} · ${info.cur} ${prodPrice}`
          : "Added"
        : prodSkipped
          ? "Skipped — add later"
          : "—",
    },
    { label: "Payments", value: paymentsSummary },
  ].map((row) => ({
    ...row,
    missing: row.value === "—" || row.value === "Not connected",
  }));

  const isLast = step === 8;
  const storeUrl = `${origin}/${slug}`;
  // The first thing a seller ever shares, and it went out untracked: the plain
  // storefront URL, so the traffic from the announcement that brings the most
  // visitors of any single post was never attributed to anything. Falls back to
  // the plain URL for shops published before publishing minted links.
  const shareUrl = model.shareToken ? shortLinkUrl(origin, model.shareToken) : storeUrl;
  const whatsappShare = `https://wa.me/?text=${encodeURIComponent(
    `My store is live! Shop ${shopName || "my products"} at ${shareUrl}`,
  )}`;

  const steps = STEP_LABELS.map((label, i) => {
    const num = i + 1;
    const current = step === num;
    const done = num < step || (num === 8 && published);
    const reachable = num <= maxStepReached;
    return { label, num, current, done, reachable };
  });

  return (
    <main className="sd-main flex min-h-svh flex-col bg-paper text-ink">
      {/* Top bar */}
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-[60px] w-full max-w-[1120px] items-center justify-between gap-3 px-5">
          <Link
            href="/"
            aria-label="SnapDuka home"
            className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink"
          >
            <LogoMark className="h-[26px] w-[26px] rounded-lg text-[15px]" />
            SnapDuka
          </Link>
          <span className="text-[12.5px] text-ink-muted">
            Setting up · <strong className="font-bold text-ink">Step {step} of 8</strong>
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pb-12 pt-6">
        {/* Stepper */}
        <div
          role="list"
          aria-label="Setup steps"
          className="mb-6.5 flex gap-1.5 overflow-x-auto pb-1.5"
        >
          {steps.map((s) => (
            <button
              key={s.label}
              role="listitem"
              type="button"
              title={s.label}
              aria-current={s.current ? "step" : undefined}
              onClick={() => {
                if (s.reachable && !busy) {
                  setStep(s.num);
                  setStepError(null);
                  setFieldErrors({});
                }
              }}
              className={`flex h-[34px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${
                s.current
                  ? "border-ink bg-ink text-paper"
                  : s.done
                    ? "border-success-line bg-success-tint text-success"
                    : s.reachable
                      ? "border-line-input bg-white text-ink-soft"
                      : "border-line-input bg-white text-[#B8AEA1]"
              }`}
            >
              {s.done ? <CheckIcon /> : <span>{s.num}</span>}
              {s.label}
            </button>
          ))}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_minmax(280px,0.8fr)] lg:gap-9">
          {/* Step form */}
          <div className="rounded-2xl border border-line bg-white p-5 sm:p-7">
            {step === 1 ? (
              <>
                <StepHeading
                  title="Name your shop"
                  sub="This is what customers see at the top of your storefront and on receipts."
                />
                <div className="grid gap-3.5">
                  <label className={LABEL}>
                    <span>Shop name<Req /></span>
                    <input
                      type="text"
                      placeholder="e.g. Ama's Closet"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                  <label className={LABEL}>
                    <span>
                      What do you sell?{" "}
                      <span className="font-normal text-ink-faint">(shown on your store)</span>
                    </span>
                    <input
                      type="text"
                      placeholder="e.g. Women's fashion, tailored in Accra"
                      value={shopDesc}
                      onChange={(e) => setShopDesc(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <StepHeading
                  title="Where do you sell?"
                  sub="Your country sets your currency and payment options. You can't change this later without support."
                />
                <div role="radiogroup" aria-label="Country" className="grid gap-2.5">
                  {(Object.keys(COUNTRY_INFO) as CountryCode[]).map((code) => {
                    const c = COUNTRY_INFO[code];
                    const on = country === code;
                    return (
                      <button
                        key={code}
                        role="radio"
                        type="button"
                        aria-checked={on}
                        disabled={countryLocked && !on}
                        onClick={() => {
                          if (!countryLocked) setCountry(code);
                        }}
                        className={`grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                          on ? "border-[1.5px] border-accent bg-raised" : "border-line bg-white"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${
                            on ? "border-accent" : "border-[#C9BBA6]"
                          }`}
                        >
                          <span
                            className={`block h-[9px] w-[9px] rounded-full ${on ? "bg-accent" : "bg-transparent"}`}
                          />
                        </span>
                        <span>
                          <span className="block text-[14px] font-bold text-ink">{c.name}</span>
                          <span className="block text-[12px] text-ink-muted">{c.sub}</span>
                        </span>
                        <span className="text-[12.5px] font-bold text-price">{c.cur}</span>
                      </button>
                    );
                  })}
                </div>
                {countryLocked ? (
                  <p className="mt-2.5 text-[12px] text-ink-muted">
                    Country is locked once your seller account is created. Contact support to change it.
                  </p>
                ) : null}
                <label className={`${LABEL} mt-3.5`}>
                  <span>City<Req /></span>
                  <input
                    type="text"
                    placeholder={info.cityPlaceholder}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={INPUT}
                  />
                </label>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <StepHeading
                  title="How can customers reach you?"
                  sub="Order confirmations and customer questions go here. WhatsApp is how most West African buyers will contact you."
                />
                <div className="grid gap-3.5">
                  <label className={LABEL}>
                    <span>Your name<Req /></span>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder="e.g. Ama Serwaa"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className={INPUT}
                    />
                    {fieldError("contactName") ? (
                      <span className="text-[12px] font-medium text-danger">{fieldError("contactName")}</span>
                    ) : null}
                  </label>
                  <label className={LABEL}>
                    <span>WhatsApp number<Req /></span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder={info.phonePlaceholder}
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      className={INPUT}
                    />
                    {fieldError("contactPhone") ? (
                      <span className="text-[12px] font-medium text-danger">{fieldError("contactPhone")}</span>
                    ) : null}
                  </label>
                  <label className={LABEL}>
                    <span>
                      Business email <span className="font-normal text-ink-faint">(optional)</span>
                    </span>
                    <input
                      type="email"
                      readOnly
                      value={model.verifiedEmail ?? ""}
                      placeholder="orders@yourshop.com"
                      className={`${INPUT} bg-paper text-ink-soft`}
                    />
                    <span className="text-[11.5px] font-normal text-ink-muted">
                      Taken from your verified sign-in email.
                    </span>
                  </label>
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <StepHeading
                  title="Your store link"
                  sub="This is the link you'll share on Instagram, TikTok, Snapchat and WhatsApp. Short and memorable works best."
                />
                <label className={LABEL}>
                  <span>Store address<Req /></span>
                  <span className="flex items-center overflow-hidden rounded-[10px] border border-line-input bg-white focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]">
                    <span className="whitespace-nowrap pl-3.5 text-[14px] text-ink-faint">{host}/</span>
                    <input
                      type="text"
                      aria-label="Store slug"
                      value={slug}
                      onChange={(e) => {
                        setSlugInput(normalizeShopSlug(e.target.value));
                        setSlugEdited(true);
                      }}
                      className="h-[46px] min-w-[80px] flex-1 border-none bg-transparent pl-0.5 pr-3.5 text-[14.5px] font-semibold text-ink outline-none"
                    />
                  </span>
                  {fieldError("slug") ? (
                    <span className="text-[12px] font-medium text-danger">{fieldError("slug")}</span>
                  ) : null}
                </label>
                <p role="status" className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
                  <CheckIcon size={13} />
                  {shopSaved && model.shop?.slug === slug ? "This is your link" : "Checked when you continue"}
                </p>
              </>
            ) : null}

            {step === 5 ? (
              <>
                <StepHeading
                  title="How do orders reach customers?"
                  sub="Pick at least one. You can add zones, fees and more methods later in Settings."
                />
                <div className="grid gap-2.5">
                  {FULFIL_OPTIONS.map((f) => {
                    const on = fulfil[f.id];
                    return (
                      <button
                        key={f.id}
                        role="checkbox"
                        type="button"
                        aria-checked={on}
                        onClick={() => setFulfil((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                        className={`grid cursor-pointer grid-cols-[auto_1fr] items-center gap-3 rounded-xl border p-3.5 text-left ${
                          on ? "border-[1.5px] border-accent bg-raised" : "border-line bg-white"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid h-[18px] w-[18px] place-items-center rounded-md border-[1.5px] ${
                            on ? "border-accent bg-accent" : "border-[#C9BBA6] bg-white"
                          }`}
                        >
                          {on ? <CheckIcon stroke="#FFF" /> : null}
                        </span>
                        <span>
                          <span className="block text-[14px] font-bold text-ink">{f.label}</span>
                          <span className="block text-[12px] text-ink-muted">{f.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!fulfillmentComplete && anyFulfil ? (
                  <div className="mt-3.5 grid gap-2.5 border-t border-line-soft pt-3.5">
                    <p className="m-0 text-[12.5px] font-semibold text-ink">
                      Delivery fee buyers pay{" "}
                      <span className="font-normal text-ink-muted">
                        (covers your rider or courier cost — 0 or blank = free)
                      </span>
                    </p>
                    {FULFIL_OPTIONS.filter((f) => fulfil[f.id]).map((f) => (
                      <label key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px] text-ink-soft">
                        {f.name}
                        <span className="flex items-center gap-1.5">
                          <span className="text-[12px] text-ink-faint">{info.cur}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Fee for ${f.name} (${info.cur})`}
                            placeholder="0"
                            value={fulfilFees[f.id] ?? ""}
                            onChange={(e) =>
                              setFulfilFees((prev) => ({
                                ...prev,
                                [f.id]: e.target.value.replace(/[^0-9.]/g, ""),
                              }))
                            }
                            className="h-10 w-28 rounded-[9px] border border-line-input bg-white px-3 text-right text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {fulfillmentComplete ? (
                  <p className="mt-2.5 text-[12px] text-ink-muted">
                    Delivery is already configured — manage methods and fees in Settings.
                  </p>
                ) : null}
              </>
            ) : null}

            {step === 6 ? (
              <>
                <StepHeading
                  title="Add your first product"
                  sub="A name, a price and stock is enough to launch. Variants and photos come later."
                />
                {productSaved ? (
                  <div
                    role="status"
                    className="rounded-xl border border-success-line bg-success-tint px-4 py-3.5 text-[13.5px] font-semibold text-success"
                  >
                    Your first product is in your catalogue. Add more from the dashboard.
                  </div>
                ) : (
                  <div className="grid gap-3.5">
                    <label className={LABEL}>
                      <span>Product name<Req /></span>
                      <input
                        type="text"
                        placeholder="e.g. Two-piece linen set"
                        value={prodName}
                        onChange={(e) => {
                          setProdName(e.target.value);
                          setProdSkipped(false);
                        }}
                        className={INPUT}
                      />
                      {fieldError("name") ? (
                        <span className="text-[12px] font-medium text-danger">{fieldError("name")}</span>
                      ) : null}
                    </label>
                    <div className="grid grid-cols-2 gap-3.5">
                      <label className={LABEL}>
                        <span>Price ({info.cur})<Req /></span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={info.pricePlaceholder}
                          value={prodPrice}
                          onChange={(e) => {
                            setProdPrice(e.target.value.replace(/[^0-9.]/g, ""));
                            setProdSkipped(false);
                          }}
                          className={INPUT}
                        />
                        {fieldError("price") ? (
                          <span className="text-[12px] font-medium text-danger">{fieldError("price")}</span>
                        ) : null}
                      </label>
                      <label className={LABEL}>
                        Quantity in stock
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="e.g. 10"
                          value={prodStock}
                          onChange={(e) => setProdStock(e.target.value.replace(/[^0-9]/g, ""))}
                          className={INPUT}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProdSkipped(true);
                        goTo(7);
                      }}
                      className="justify-self-start cursor-pointer border-none bg-transparent p-0 text-[12.5px] font-semibold text-ink-muted underline hover:text-ink-soft"
                    >
                      Skip for now — add products later
                    </button>
                  </div>
                )}
              </>
            ) : null}

            {step === 7 ? (
              <>
                <StepHeading
                  title="Get paid"
                  sub={
                    isCI
                      ? "Online payments are not yet available in Côte d'Ivoire. Your customers can pay on delivery or by transfer, and you confirm receipt."
                      : "Connect Paystack to accept cards and mobile money at checkout. Payouts go straight to your bank or MoMo wallet."
                  }
                />
                {isCI ? (
                  <div className="rounded-xl border border-warn-line bg-warn-tint px-4 py-3.5 text-[13px] leading-[1.6] text-warn">
                    Offline payments are enabled automatically — buyers see the offline option at
                    checkout and you mark payments as received.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center gap-3.5 rounded-[14px] border border-line p-4.5">
                      <span
                        aria-hidden="true"
                        className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-success-tint"
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <rect x="2.5" y="5" width="15" height="10.5" rx="1.8" stroke="#047857" strokeWidth="1.5" />
                          <path d="M2.5 8.5h15" stroke="#047857" strokeWidth="1.5" />
                        </svg>
                      </span>
                      <div className="flex-1">
                        <p className="text-[14px] font-bold">Paystack</p>
                        <p
                          className={`text-[12px] font-semibold ${
                            paymentComplete
                              ? "text-success"
                              : paymentState?.status === "error"
                                ? "text-danger"
                                : "text-warn"
                          }`}
                          role="status"
                        >
                          {paymentComplete
                            ? "Connected — payouts to your account"
                            : (paymentState?.message ??
                              (model.settlement
                                ? `Settlement saved · account ending ${model.settlement.accountLast4}`
                                : "Not connected"))}
                        </p>
                      </div>
                    </div>
                    {!paymentComplete ? (
                      <div className="grid gap-3.5">
                        <div className="grid grid-cols-2 gap-3.5">
                          <label className={LABEL}>
                            <span>Bank / MoMo code<Req /></span>
                            <input
                              type="text"
                              placeholder="e.g. MTN"
                              value={bankCode}
                              onChange={(e) => setBankCode(e.target.value)}
                              className={INPUT}
                            />
                            {fieldError("bankCode") ? (
                              <span className="text-[12px] font-medium text-danger">{fieldError("bankCode")}</span>
                            ) : null}
                          </label>
                          <label className={LABEL}>
                            <span>Bank / wallet name<Req /></span>
                            <input
                              type="text"
                              placeholder="e.g. MTN Mobile Money"
                              value={bankName}
                              onChange={(e) => setBankName(e.target.value)}
                              className={INPUT}
                            />
                            {fieldError("bankName") ? (
                              <span className="text-[12px] font-medium text-danger">{fieldError("bankName")}</span>
                            ) : null}
                          </label>
                        </div>
                        <label className={LABEL}>
                          <span>Account number<Req /></span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="Payouts are sent here"
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value)}
                            className={INPUT}
                          />
                          <span className="text-[11.5px] font-normal text-ink-muted">
                            Sent only during this request — never stored in full.
                          </span>
                          {fieldError("accountNumber") ? (
                            <span className="text-[12px] font-medium text-danger">{fieldError("accountNumber")}</span>
                          ) : null}
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={connectPaystack}
                          className="h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                        >
                          {busy ? "Connecting…" : "Connect"}
                        </button>
                      </div>
                    ) : null}
                    <p className="mt-3 text-[12px] leading-[1.6] text-ink-muted">
                      You can also accept offline payments (cash on delivery, bank transfer) and
                      confirm them manually — enable this later in Settings.
                    </p>
                  </>
                )}
              </>
            ) : null}

            {step === 8 ? (
              <>
                <StepHeading
                  title="Review and publish"
                  sub="Everything can be changed later. Publishing makes your storefront live at your link."
                />
                <div className="mb-4 grid overflow-hidden rounded-[14px] border border-line">
                  {reviewRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex justify-between gap-3.5 border-b border-[#F7F2EA] px-4 py-3 text-[13px] last:border-b-0"
                    >
                      <span className="font-semibold text-ink-muted">{row.label}</span>
                      <span className={`text-right font-bold ${row.missing ? "text-danger" : "text-ink"}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
                {!published ? (
                  <label className="mb-1 flex cursor-pointer items-start gap-2.5 text-[13px] leading-[1.5] text-ink-2">
                    <input
                      type="checkbox"
                      checked={policyAccepted}
                      onChange={(e) => setPolicyAccepted(e.target.checked)}
                      className="mt-0.5 h-[18px] w-[18px] accent-[#A8431A]"
                    />
                    <span>
                      I accept the{" "}
                      <Link href="/terms" className="font-semibold text-accent underline" target="_blank">
                        seller policy
                      </Link>{" "}
                      — required for publishing and payments.
                    </span>
                  </label>
                ) : (
                  <div
                    role="status"
                    className="rounded-xl border border-success-line bg-success-tint p-4 text-center"
                  >
                    <p className="mb-1 text-[15px] font-bold text-success">Your store is live</p>
                    <p className="mb-3 text-[13px] text-[#2E6B54]">
                      {host}/{slug}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <a
                        href={whatsappShare}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-10 items-center rounded-[9px] bg-success px-4 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
                      >
                        Share on WhatsApp
                      </a>
                      <Link
                        href="/dashboard"
                        className="inline-flex h-10 items-center rounded-[9px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink"
                      >
                        Go to dashboard
                      </Link>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {/* Step navigation */}
            {!published ? (
              <div className="mt-6 flex gap-2.5 border-t border-line-soft pt-4.5">
                {step > 1 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setStep((s) => Math.max(1, s - 1));
                      setStepError(null);
                      setFieldErrors({});
                    }}
                    className="h-[46px] cursor-pointer rounded-[10px] border border-line-strong bg-white px-4.5 text-[13.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:opacity-50"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={continueFromStep}
                  className={`h-[46px] flex-1 cursor-pointer rounded-[10px] border-none px-4 text-[14px] font-bold text-white transition-colors disabled:cursor-wait disabled:bg-[#C08B6E] ${
                    isLast ? "bg-success hover:bg-success-deep" : "bg-accent hover:bg-accent-deep"
                  }`}
                >
                  {busy
                    ? isLast
                      ? "Publishing…"
                      : "Saving…"
                    : isLast
                      ? "Publish my store"
                      : "Continue"}
                </button>
              </div>
            ) : null}
            {stepError ? (
              <p role="alert" className="mt-2.5 text-[12.5px] font-semibold text-danger">
                {stepError}
              </p>
            ) : null}
          </div>

          {/* Live preview */}
          <div aria-label="Live storefront preview" className="sticky top-5 hidden justify-items-center gap-2.5 sm:grid">
            <div className="w-[min(270px,100%)] rounded-[30px] bg-ink p-[9px] shadow-[0_20px_40px_-18px_rgba(33,27,20,0.32)]">
              <div className="min-h-[430px] overflow-hidden rounded-[23px] bg-raised">
                <div className="grid h-6 place-items-center">
                  <span className="block h-1.5 w-[66px] rounded bg-[#E8E0D3]" />
                </div>
                <div className="flex items-center gap-2 border-b border-line-soft px-3.5 pb-2 pt-2.5">
                  <span
                    aria-hidden="true"
                    className="h-[30px] w-[30px] flex-none rounded-full bg-[linear-gradient(135deg,#D9C6A8,#A8875D)]"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-bold">{shopName || "Your shop name"}</p>
                    <p className="truncate text-[9.5px] text-ink-muted">
                      {(city || "Your city") + " · " + (shopDesc || "What you sell")}
                    </p>
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-faint">
                    Products
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="overflow-hidden rounded-[11px] border border-line-soft bg-white">
                      <span
                        aria-hidden="true"
                        className="block h-[62px] bg-[linear-gradient(140deg,#E4D5BF,#A8875D)]"
                      />
                      <div className="px-2 pb-2 pt-1.5">
                        <p className="mb-0.5 truncate text-[10px] font-semibold">
                          {prodSkipped || !prodName ? "Your first product" : prodName}
                        </p>
                        <p className="text-[10px] font-bold text-price">
                          {prodSkipped || !prodPrice ? `${info.cur} —` : `${info.cur} ${prodPrice}`}
                        </p>
                      </div>
                    </div>
                    <div className="grid min-h-[100px] place-items-center rounded-[11px] border-[1.5px] border-dashed border-[#EDE4D6]">
                      <span className="text-[9.5px] font-semibold text-[#C9BBA6]">Next product</span>
                    </div>
                  </div>
                </div>
                <div className="px-3 pb-3.5 pt-1">
                  <span className="block rounded-[9px] bg-accent py-2 text-center text-[11px] font-semibold text-white">
                    View cart
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-ink-faint">
              Live preview · {host}/{slug}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
