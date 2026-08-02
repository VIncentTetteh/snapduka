"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { courierOptions, requiresCustomName, type CourierKey } from "@/lib/couriers/catalogue";
import type { CountryCode } from "@/lib/countries/types";

type Props = {
  orderId: string;
  country: CountryCode;
  /** Present when correcting an existing delivery rather than recording a new one. */
  existing?: {
    provider: CourierKey;
    providerName: string | null;
    trackingNumber: string;
    trackingUrl: string | null;
  } | null;
};

export function ShippingBookingForm({ orderId, country, existing }: Props) {
  const router = useRouter();
  const options = courierOptions(country);
  // 'manual' predates the picker and is not offered, so a legacy shipment opens
  // on the first real option rather than a value the seller cannot re-select.
  const initialProvider =
    existing && existing.provider !== "manual" ? existing.provider : options[0].key;

  const [provider, setProvider] = useState<CourierKey>(initialProvider);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const needsName = requiresCustomName(provider);

  return (
    <form
      className="card grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("Saving delivery…");
        const values = new FormData(event.currentTarget);
        const providerName = String(values.get("providerName") ?? "").trim();
        const trackingNumber = String(values.get("trackingNumber") ?? "").trim();
        const trackingUrl = String(values.get("trackingUrl") ?? "").trim();

        // One request. The old flow called /api/couriers/quotes first purely to
        // mint a quoteId that the booking then ignored.
        const response = await fetch("/api/couriers/book", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderId,
            provider,
            providerName: providerName || undefined,
            trackingNumber: trackingNumber || undefined,
            trackingUrl: trackingUrl || undefined,
          }),
        });
        const result = await response.json();
        setMessage(
          response.ok
            ? "Saved. Your buyer can see this on their order page."
            : (result.error ?? "Could not save the delivery."),
        );
        setPending(false);
        if (response.ok) router.refresh();
      }}
    >
      <div>
        <h2 className="m-0 text-lg font-extrabold">
          {existing ? "Update delivery" : "Record delivery"}
        </h2>
        <p className="page-sub m-0 mt-1">
          Tell your buyer who is delivering. If the courier has a public tracking page, paste the
          link and the buyer can follow it themselves.
        </p>
      </div>

      <label className="grid gap-1">
        <span className="field-label">Courier</span>
        <select
          className="field-input"
          name="provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value as CourierKey)}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {needsName ? (
        <label className="grid gap-1">
          <span className="field-label">Courier name</span>
          <input
            className="field-input"
            defaultValue={existing?.providerName ?? ""}
            maxLength={60}
            name="providerName"
            placeholder="e.g. Kwame Express"
            required
          />
        </label>
      ) : null}

      <label className="grid gap-1">
        <span className="field-label">Tracking or rider reference</span>
        <input
          className="field-input"
          defaultValue={existing?.trackingNumber ?? ""}
          name="trackingNumber"
          placeholder="RIDER-2048"
        />
        <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
          Leave blank and we&apos;ll generate one your buyer can quote back to you.
        </span>
      </label>

      <label className="grid gap-1">
        <span className="field-label">Tracking link (optional)</span>
        <input
          className="field-input"
          defaultValue={existing?.trackingUrl ?? ""}
          name="trackingUrl"
          placeholder="https://courier.example/track/…"
          type="url"
        />
        <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
          Opens in a new tab for the buyer. Only add it if the courier gives a public link.
        </span>
      </label>

      <button className="btn-primary w-full" disabled={pending} type="submit">
        {pending ? "Saving…" : existing ? "Update delivery" : "Save delivery"}
      </button>
      <p aria-live="polite" className="m-0 text-sm" role="status">
        {message}
      </p>
    </form>
  );
}
