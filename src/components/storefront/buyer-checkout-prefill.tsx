"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { readDeliveryExtras } from "@/components/storefront/delivery-address-extras";
import type { CountryCode } from "@snapduka/core";
import { validatePhone } from "@/lib/validation";

/**
 * Signed-in buyer conveniences for the storefront checkout (flag
 * `buyer_accounts`): fill in name, phone and address, and offer to save the
 * address. Strictly additive — for a guest, or with the flag off, the prefill
 * endpoint answers `{ signedIn: false }` and this renders at most a sign-in
 * link, leaving the form exactly as it was.
 *
 * It fills the form's existing uncontrolled inputs directly and only when they
 * are empty, so it can never overwrite something the buyer already typed, and
 * the checkout form keeps a single source of truth for what gets submitted.
 */

type PrefillAddress = {
  id: string;
  label: string | null;
  line1: string;
  area: string;
  city: string;
  region: string;
  country: CountryCode;
  digitalAddress: string | null;
  landmark: string | null;
};

type Prefill =
  | { signedIn: false; available?: boolean }
  | {
      signedIn: true;
      name: string | null;
      phone: string;
      defaultAddressId: string | null;
      addresses: PrefillAddress[];
    };

export const SAVE_ADDRESS_FIELD = "saveBuyerAddress";

function fillIfEmpty(form: HTMLFormElement, name: string, value: string | null | undefined) {
  if (!value) return;
  const input = form.elements.namedItem(name);
  if (input instanceof HTMLInputElement && input.type !== "hidden" && input.value.trim() === "") {
    input.value = value;
  }
}

export function BuyerCheckoutPrefill({ country }: { country: CountryCode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/buyer/checkout-prefill", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Prefill>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPrefill(data);
        const form = anchor.current?.closest("form");
        if (!data.signedIn || !form) return;

        fillIfEmpty(form, "name", data.name);
        // A number from another country would only fail this shop's validation.
        if (!validatePhone(data.phone, country)) fillIfEmpty(form, "phone", data.phone);
        const address =
          data.addresses.find((a) => a.id === data.defaultAddressId && a.country === country) ??
          data.addresses.find((a) => a.country === country);
        if (address) {
          fillIfEmpty(form, "line1", address.line1);
          fillIfEmpty(form, "area", address.area);
          fillIfEmpty(form, "city", address.city);
          fillIfEmpty(form, "region", address.region);
          // Squad C's optional rider-help fields; absent for non-GH shops.
          fillIfEmpty(form, "digitalAddress", address.digitalAddress);
          fillIfEmpty(form, "landmark", address.landmark);
        }
      })
      // Never in the way of checkout: any failure just means no prefill.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [country]);

  return (
    <div ref={anchor}>
      {prefill?.signedIn ? (
        <div className="mb-3 grid gap-2 rounded-[10px] border border-line bg-raised px-3.5 py-2.5 text-[12.5px] text-ink-soft">
          <span>
            Signed in to SnapDuka as <strong className="font-semibold text-ink">{prefill.phone}</strong>. We filled in
            your saved details — check them before you order.
          </span>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" name={SAVE_ADDRESS_FIELD} className="h-4 w-4 accent-[#A8431A]" />
            Save this delivery address to my SnapDuka account
          </label>
        </div>
      ) : prefill?.available ? (
        <p className="mb-3 text-[12.5px] text-ink-soft">
          Ordered on SnapDuka before?{" "}
          <Link
            className="font-semibold text-accent underline"
            href={`/me?${new URLSearchParams({ next: window.location.pathname + window.location.search })}`}
          >
            Sign in with your phone
          </Link>{" "}
          to fill this in. Or just continue as a guest.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Called by the checkout form once the order exists. Fire-and-forget with
 * keepalive, because the page navigates away (tracking page or Paystack)
 * immediately after; a failure costs the buyer nothing but the saved address.
 */
export function saveBuyerAddressIfRequested(values: FormData, country: CountryCode): void {
  if (values.get(SAVE_ADDRESS_FIELD) !== "on") return;
  const line1 = String(values.get("line1") ?? "").trim();
  const city = String(values.get("city") ?? "").trim();
  if (!line1 || !city) return; // pickup orders carry no address to save
  void fetch("/api/buyer/addresses", {
    method: "POST",
    keepalive: true,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      line1,
      city,
      area: String(values.get("area") ?? "").trim(),
      region: String(values.get("region") ?? "").trim(),
      country,
      // Same parsing the order itself used, so the saved copy matches what was sent.
      ...readDeliveryExtras(values, country),
    }),
  }).catch(() => {});
}
