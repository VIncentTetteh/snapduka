"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useCart } from "@/components/storefront/cart-provider";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { Req } from "@/components/ui/required-mark";
import {
  validateEmail,
  validateName,
  validatePhone,
  validateRequired,
} from "@/lib/validation";
import type { CountryCode, CurrencyCode } from "@/lib/countries/types";
import { formatPrice } from "@/lib/storefront/price";

type Method = { id: string; name: string; type: string; fee_minor: number; instructions: string };
type CheckoutProduct = {
  id: string;
  name: string;
  currency: string;
  price_minor: number;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
};

const INPUT =
  "h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";
const SECTION = "mb-4 rounded-[14px] border border-line bg-white p-4.5";
const SECTION_TITLE = "mb-3 text-[14px] font-bold text-ink";
const LABEL = "grid gap-1.5 text-[12.5px] font-semibold text-ink";

export function CheckoutForm({
  shopId,
  shopName,
  country,
  products,
  methods,
  campaignToken,
  fromCart,
  onlinePaymentsAvailable,
}: {
  shopId: string;
  shopName: string;
  country: CountryCode;
  products: CheckoutProduct[];
  methods: Method[];
  campaignToken?: string;
  fromCart: boolean;
  onlinePaymentsAvailable: boolean;
}) {
  const router = useRouter();
  const cart = useCart();
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState(methods[0]?.id ?? "");
  const paystackOffered = onlinePaymentsAvailable && country !== "CI";
  const [paymentMethod, setPaymentMethod] = useState(paystackOffered ? "paystack" : "cash_on_delivery");
  const [recoveryContact, setRecoveryContact] = useState("");
  const [recoveryConsent, setRecoveryConsent] = useState(false);
  const recoveryCaptured = useRef(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      products.map((product) => [`${product.id}:${product.variantId ?? "base"}`, product.quantity]),
    ),
  );
  const idempotencyKey = useMemo(() => `checkout-${crypto.randomUUID()}`, []);
  useEffect(() => {
    queueMicrotask(() => setHydrated(true));
  }, []);

  const selectedMethod = methods.find((m) => m.id === selectedMethodId);
  const isPickup = selectedMethod?.type === "pickup";
  const fee = selectedMethod?.fee_minor ?? 0;
  const itemTotal = products.reduce(
    (sum, product) => sum + product.price_minor * quantities[`${product.id}:${product.variantId ?? "base"}`],
    0,
  );
  const orderTotal = itemTotal + fee;
  const currency = products[0]?.currency ?? "GHS";
  const effectivePayment = isPickup ? "pay_on_pickup" : paymentMethod;

  async function captureRecovery(contact: string, consent: boolean) {
    if (!consent || recoveryCaptured.current || !contact.includes("@")) return;
    recoveryCaptured.current = true;
    const response = await fetch("/api/checkout/abandoned", {
      body: JSON.stringify({
        campaignToken,
        cart: products.map((product) => ({
          productId: product.id,
          quantity: quantities[`${product.id}:${product.variantId ?? "base"}`],
        })),
        consent: true,
        contact,
        shopId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) recoveryCaptured.current = false;
  }

  function fmtPrice(minor: number) {
    return formatPrice(minor, currency as CurrencyCode);
  }

  function validateBuyerFields(values: FormData): Record<string, string> {
    const errors: Record<string, string> = {};
    const nameError = validateName(String(values.get("name") ?? ""), "your full name");
    if (nameError) errors.name = nameError;
    const emailError = validateEmail(String(values.get("email") ?? ""));
    if (emailError) errors.email = emailError;
    const phoneError = validatePhone(String(values.get("phone") ?? ""), country);
    if (phoneError) errors.phone = phoneError;
    if (!isPickup) {
      const line1Error = validateRequired(
        String(values.get("line1") ?? ""),
        "Enter the delivery address.",
      );
      if (line1Error) errors.line1 = line1Error;
      const cityError = validateRequired(String(values.get("city") ?? ""), "Enter the city.");
      if (cityError) errors.city = cityError;
    }
    return errors;
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function stepQuantity(key: string, delta: number) {
    setQuantities((current) => ({
      ...current,
      [key]: Math.max(1, Math.min(99, (current[key] ?? 1) + delta)),
    }));
  }

  const payLabel = pending
    ? "Processing…"
    : effectivePayment === "paystack"
      ? `Pay ${fmtPrice(orderTotal)} with Paystack`
      : `Place order · ${fmtPrice(orderTotal)}`;

  return (
    <form
      id="checkout-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const errors = validateBuyerFields(values);
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) {
          setFailed(true);
          setMessage("Check the highlighted fields before continuing.");
          const firstInvalid = event.currentTarget.querySelector<HTMLElement>("[aria-invalid='true']");
          firstInvalid?.focus();
          return;
        }
        setPending(true);
        setFailed(false);
        setMessage("Placing your order…");
        try {
          const response = await fetch("/api/checkout/orders", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              shopId,
              fulfillmentMethodId: selectedMethodId,
              idempotencyKey,
              paymentMethod: effectivePayment,
              promotionCode: values.get("promotionCode"),
              campaignToken,
              buyer: {
                name: values.get("name"),
                email: values.get("email"),
                phone: values.get("phone"),
                country,
                address: {
                  line1: values.get("line1"),
                  area: values.get("area"),
                  city: values.get("city"),
                  region: values.get("region"),
                },
                marketingConsent: values.get("marketingConsent") === "on",
              },
              lines: products.map((product) => ({
                productId: product.id,
                variantId: product.variantId,
                quantity: quantities[`${product.id}:${product.variantId ?? "base"}`],
              })),
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (effectivePayment === "paystack") {
            const payment = await fetch("/api/payments/paystack/initialize", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ orderId: result.orderId }),
            });
            const paymentResult = await payment.json();
            if (payment.ok && paymentResult.authorizationUrl) {
              window.location.href = paymentResult.authorizationUrl;
              return;
            }
            // Keep the buyer here — the order exists (same idempotency key on
            // retry), but no payment has happened. Never pretend it did.
            throw new Error(
              paymentResult.error ??
                "Payment could not be started. Retry, or choose pay on delivery.",
            );
          }
          if (fromCart) cart.clear();
          router.push(`/orders/${result.trackingToken}`);
        } catch (error) {
          setFailed(true);
          setMessage(
            error instanceof Error
              ? error.message
              : "Connection failed. Your details are preserved; retry when online.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {/* Cart summary */}
      <section aria-label="Your items" className="mb-4 overflow-hidden rounded-[14px] border border-line bg-white">
        {products.map((product) => {
          const key = `${product.id}:${product.variantId ?? "base"}`;
          return (
            <div
              key={key}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4 py-3 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="block h-11 w-11 rounded-[10px]"
                style={{ background: gradientForSeed(product.id) }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{product.name}</span>
                <span className="block text-[11.5px] text-ink-muted">
                  {product.variantName ? (
                    <>
                      <span>{product.variantName}</span> ·{" "}
                    </>
                  ) : null}
                  {fmtPrice(product.price_minor)}
                </span>
              </span>
              <span className="flex items-center gap-2.5">
                <span className="flex items-center rounded-[9px] border border-line-input bg-white">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${product.name}`}
                    onClick={() => stepQuantity(key, -1)}
                    className="h-10 w-10 cursor-pointer border-none bg-transparent text-[15px] text-ink-soft"
                  >
                    −
                  </button>
                  <span className="min-w-[22px] text-center text-[13px] font-bold">{quantities[key]}</span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${product.name}`}
                    onClick={() => stepQuantity(key, 1)}
                    className="h-10 w-10 cursor-pointer border-none bg-transparent text-[15px] text-ink-soft"
                  >
                    +
                  </button>
                </span>
                <span className="min-w-[74px] whitespace-nowrap text-right text-[13.5px] font-bold">
                  {fmtPrice(product.price_minor * quantities[key])}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      {/* Contact */}
      <section aria-label="Contact details" className={`${SECTION} grid gap-3`}>
        <h2 className={`${SECTION_TITLE} mb-0`}>Contact</h2>
        <label className={LABEL}>
          <span>Full name<Req /></span>
          <input
            className={INPUT}
            autoComplete="name"
            name="name"
            placeholder="Full name"
            required
            aria-required="true"
            aria-invalid={fieldErrors.name ? "true" : undefined}
            onChange={() => clearFieldError("name")}
          />
          {fieldErrors.name ? (
            <span role="alert" className="text-[12px] font-medium text-danger">{fieldErrors.name}</span>
          ) : null}
        </label>
        <label className={LABEL}>
          <span>Email<Req /></span>
          <input
            className={INPUT}
            autoComplete="email"
            name="email"
            type="email"
            placeholder="Email"
            required
            aria-required="true"
            aria-invalid={fieldErrors.email ? "true" : undefined}
            onBlur={() => void captureRecovery(recoveryContact, recoveryConsent)}
            onChange={(event) => {
              setRecoveryContact(event.target.value);
              clearFieldError("email");
            }}
          />
          {fieldErrors.email ? (
            <span role="alert" className="text-[12px] font-medium text-danger">{fieldErrors.email}</span>
          ) : null}
        </label>
        <label className={LABEL}>
          <span>WhatsApp number<Req /></span>
          <input
            className={INPUT}
            autoComplete="tel"
            name="phone"
            required
            aria-required="true"
            aria-invalid={fieldErrors.phone ? "true" : undefined}
            onChange={() => clearFieldError("phone")}
            placeholder={country === "GH" ? "024 123 4567" : country === "NG" ? "0801 234 5678" : "07 08 09 10 11"}
          />
          {fieldErrors.phone ? (
            <span role="alert" className="text-[12px] font-medium text-danger">{fieldErrors.phone}</span>
          ) : null}
          <span className="text-[11.5px] font-normal text-ink-muted">
            Used for order updates only — no account needed.
          </span>
        </label>
      </section>

      {/* Delivery */}
      <section aria-label="Delivery" className={SECTION}>
        <h2 className={SECTION_TITLE}>Delivery</h2>
        <div role="radiogroup" aria-label="Fulfilment method" className="mb-3 grid gap-2">
          {methods.map((method) => {
            const on = selectedMethodId === method.id;
            return (
              <label
                key={method.id}
                className={`grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[11px] border p-3.5 ${
                  on ? "border-[1.5px] border-accent bg-raised" : "border-line bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="fulfillmentMethodId"
                  value={method.id}
                  checked={on}
                  required
                  onChange={() => setSelectedMethodId(method.id)}
                  className="h-[18px] w-[18px] accent-[#A8431A]"
                />
                <span>
                  <span className="block text-[13.5px] font-bold text-ink">{method.name}</span>
                  {method.instructions ? (
                    <span className="block text-[11.5px] text-ink-muted">{method.instructions}</span>
                  ) : null}
                </span>
                <span className="text-[13px] font-bold text-ink">
                  {method.fee_minor > 0 ? fmtPrice(method.fee_minor) : "Free"}
                </span>
              </label>
            );
          })}
        </div>
        {!isPickup ? (
          <div className="grid gap-3">
            <label className={LABEL}>
              <span>Delivery address<Req /></span>
              <input
                className={INPUT}
                autoComplete="address-line1"
                name="line1"
                placeholder="Street, area, landmark…"
                required
                aria-required="true"
                aria-invalid={fieldErrors.line1 ? "true" : undefined}
                onChange={() => clearFieldError("line1")}
              />
              {fieldErrors.line1 ? (
                <span role="alert" className="text-[12px] font-medium text-danger">{fieldErrors.line1}</span>
              ) : null}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input className={INPUT} name="area" placeholder="Area (optional)" aria-label="Area" />
              <input
                className={INPUT}
                autoComplete="address-level2"
                name="city"
                placeholder="City *"
                aria-label="City"
                required
                aria-required="true"
                aria-invalid={fieldErrors.city ? "true" : undefined}
                onChange={() => clearFieldError("city")}
              />
            </div>
            {fieldErrors.city ? (
              <span role="alert" className="text-[12px] font-medium text-danger">{fieldErrors.city}</span>
            ) : null}
            <input
              className={INPUT}
              autoComplete="address-level1"
              name="region"
              placeholder={country === "NG" ? "State (optional)" : "Region (optional)"}
              aria-label={country === "NG" ? "State" : "Region"}
            />
          </div>
        ) : (
          <>
            <input type="hidden" name="line1" value="" />
            <input type="hidden" name="area" value="" />
            <input type="hidden" name="city" value="" />
            <input type="hidden" name="region" value="" />
          </>
        )}
      </section>

      {/* Payment */}
      <section aria-label="Payment" className={SECTION}>
        <h2 className={SECTION_TITLE}>Payment</h2>
        {!isPickup ? (
          <div role="radiogroup" aria-label="Payment method" className="mb-3.5 grid gap-2">
            {paystackOffered ? (
              <label
                className={`grid cursor-pointer grid-cols-[auto_1fr] items-center gap-3 rounded-[11px] border p-3.5 ${
                  paymentMethod === "paystack" ? "border-[1.5px] border-accent bg-raised" : "border-line bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="paystack"
                  checked={paymentMethod === "paystack"}
                  onChange={() => setPaymentMethod("paystack")}
                  className="h-[18px] w-[18px] accent-[#A8431A]"
                />
                <span>
                  <span className="block text-[13.5px] font-bold text-ink">Pay now with Paystack</span>
                  <span className="block text-[11.5px] text-ink-muted">
                    Card, mobile money or bank — instant confirmation
                  </span>
                </span>
              </label>
            ) : null}
            <label
              className={`grid cursor-pointer grid-cols-[auto_1fr] items-center gap-3 rounded-[11px] border p-3.5 ${
                paymentMethod === "cash_on_delivery" ? "border-[1.5px] border-accent bg-raised" : "border-line bg-white"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="cash_on_delivery"
                checked={paymentMethod === "cash_on_delivery"}
                onChange={() => setPaymentMethod("cash_on_delivery")}
                className="h-[18px] w-[18px] accent-[#A8431A]"
              />
              <span>
                <span className="block text-[13.5px] font-bold text-ink">Pay on delivery or transfer</span>
                <span className="block text-[11.5px] text-ink-muted">
                  Arrange payment with the seller — order stays pending until confirmed
                </span>
              </span>
            </label>
          </div>
        ) : (
          <p className="mb-3.5 text-[12.5px] text-ink-soft">
            Pay when you pick up — the seller confirms receipt.
          </p>
        )}
        <label className={LABEL}>
          <span>
            Promo code <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input className={INPUT} id="promo-code" name="promotionCode" placeholder="e.g. LAUNCH20" />
        </label>
      </section>

      {/* Totals + consent + pay */}
      <section aria-label="Order summary" className={SECTION}>
        <div className="mb-3.5 grid gap-2">
          <span className="flex justify-between text-[13.5px] text-ink-soft">
            <span>Subtotal</span>
            <span className="font-semibold text-ink">{fmtPrice(itemTotal)}</span>
          </span>
          <span className="flex justify-between text-[13.5px] text-ink-soft">
            <span>{selectedMethod ? `Delivery · ${selectedMethod.name}` : "Delivery"}</span>
            <span className="font-semibold text-ink">{fee > 0 ? fmtPrice(fee) : "Free"}</span>
          </span>
          <span className="flex justify-between border-t border-line-soft pt-2.5 text-[15.5px] font-bold text-ink">
            <span>Total</span>
            <span>{fmtPrice(orderTotal)}</span>
          </span>
        </div>

        <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-[1.5] text-ink-soft">
          <input
            type="checkbox"
            name="marketingConsent"
            className="mt-0.5 h-[17px] w-[17px] accent-[#A8431A]"
            onChange={(event) => {
              setRecoveryConsent(event.target.checked);
              void captureRecovery(recoveryContact, event.target.checked);
            }}
          />
          Keep me updated about new drops and offers from {shopName} on WhatsApp. Optional — you
          can opt out anytime.
        </label>

        <div aria-live="polite" role="status" className="mb-3 min-h-5">
          {failed ? (
            <div className="flex gap-2.5 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-px flex-none">
                <path d="M9 6.5v3.2m0 2.6h.01M9 2 1.8 15h14.4L9 2Z" stroke="#B42318" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="m-0 text-[12.5px] leading-[1.5] text-[#7A1B10]">
                <strong className="font-bold">That didn&rsquo;t go through.</strong> {message} Your
                details are saved — check your network or try another method, then retry.
              </p>
            </div>
          ) : (
            <p className="m-0 text-[12.5px] text-ink-soft">{message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={!hydrated || pending || methods.length === 0}
          className={`h-[52px] w-full cursor-pointer rounded-xl border-none text-[15.5px] font-bold text-white transition-colors disabled:cursor-wait disabled:opacity-60 ${
            effectivePayment === "paystack"
              ? "bg-success hover:bg-success-deep"
              : "bg-ink hover:bg-ink-2"
          }`}
        >
          {!hydrated ? "Loading checkout…" : payLabel}
        </button>
        <p className="m-0 mt-2.5 text-center text-[11.5px] text-ink-muted">
          Secured by Paystack · Guest checkout · No account needed
        </p>
      </section>
    </form>
  );
}
