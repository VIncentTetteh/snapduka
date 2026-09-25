"use client";

import { useState } from "react";

import {
  ghanaPostGpsError,
  LANDMARK_MAX_LENGTH,
  normalizeGhanaPostGps,
  roundCoordinate,
  type CountryCode,
} from "@snapduka/core";

/**
 * Optional courier-grade address detail for the storefront checkout: a
 * GhanaPostGPS code (Ghana only), a landmark, and a "use my location" pin.
 *
 * Folded away by default. Most buyers are on low-end Android phones and
 * patchy data; the four classic fields already get the parcel delivered, so
 * none of this may add weight or a required step. No map library, no script,
 * no network call — the pin is navigator.geolocation and two hidden inputs.
 *
 * The values ride along in buyer.address (see readDeliveryExtras); the server
 * re-validates everything and derives orders.delivery_address from it.
 */

const INPUT =
  "h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";

type PinState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "set"; lat: number; lng: number; accuracy: number }
  | { kind: "error"; message: string };

// Fresh enough to be where the buyer is now, quick enough not to hang a
// checkout on a phone with a weak GPS fix.
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 };

export function DeliveryAddressExtras({
  country,
  error,
  onEdit,
}: {
  country: CountryCode;
  /** Validation message for the digital address, from the form's own validation pass. */
  error?: string;
  onEdit?: () => void;
}) {
  const [pin, setPin] = useState<PinState>({ kind: "idle" });

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPin({ kind: "error", message: "Your browser cannot share your location." });
      return;
    }
    setPin({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setPin({
          kind: "set",
          lat: roundCoordinate(position.coords.latitude),
          lng: roundCoordinate(position.coords.longitude),
          accuracy: Math.round(position.coords.accuracy),
        }),
      (failure) =>
        setPin({
          kind: "error",
          message:
            failure.code === failure.PERMISSION_DENIED
              ? "Location permission was refused. You can still type your address."
              : "We could not find your location. You can still type your address.",
        }),
      GEO_OPTIONS,
    );
  }

  return (
    <details className="rounded-[10px] border border-line bg-raised px-3.5 py-2.5 text-[12.5px] text-ink">
      <summary className="cursor-pointer font-semibold">
        Help the rider find you <span className="font-normal text-ink-muted">(optional)</span>
      </summary>
      <div className="mt-3 grid gap-3">
        {country === "GH" ? (
          <label className="grid gap-1.5 font-semibold">
            <span>GhanaPostGPS address</span>
            <input
              className={INPUT}
              name="digitalAddress"
              placeholder="e.g. GA-123-4567"
              autoCapitalize="characters"
              maxLength={20}
              aria-invalid={error ? "true" : undefined}
              onChange={onEdit}
            />
            {error ? (
              <span role="alert" className="text-[12px] font-medium text-danger">
                {error}
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="grid gap-1.5 font-semibold">
          <span>Landmark</span>
          <input
            className={INPUT}
            name="landmark"
            placeholder="e.g. Blue gate opposite the Total station"
            maxLength={LANDMARK_MAX_LENGTH}
          />
        </label>
        <div className="grid gap-1.5">
          <button
            type="button"
            onClick={locate}
            disabled={pin.kind === "locating"}
            className="h-10 rounded-[10px] border border-line-input bg-white px-3.5 text-[13px] font-semibold text-ink disabled:opacity-60"
          >
            {pin.kind === "locating" ? "Finding you…" : pin.kind === "set" ? "Update my location" : "Use my location"}
          </button>
          <span aria-live="polite" className="text-[12px] text-ink-muted">
            {pin.kind === "set"
              ? `Location pinned (within about ${pin.accuracy} m). Only the seller and their courier see it.`
              : pin.kind === "error"
                ? pin.message
                : "Shares a map pin with the seller, not your live location."}
          </span>
          {pin.kind === "set" ? (
            <>
              <input type="hidden" name="lat" value={String(pin.lat)} />
              <input type="hidden" name="lng" value={String(pin.lng)} />
            </>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export type DeliveryExtras = {
  digitalAddress?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
};

/** The optional fields from the checkout form, omitting anything blank or unusable. */
export function readDeliveryExtras(values: FormData, country: CountryCode): DeliveryExtras {
  const extras: DeliveryExtras = {};
  if (country === "GH") {
    const code = normalizeGhanaPostGps(String(values.get("digitalAddress") ?? ""));
    if (code) extras.digitalAddress = code;
  }
  const landmark = String(values.get("landmark") ?? "").trim();
  if (landmark) extras.landmark = landmark.slice(0, LANDMARK_MAX_LENGTH);
  const lat = Number(values.get("lat"));
  const lng = Number(values.get("lng"));
  if (values.get("lat") !== null && values.get("lng") !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
    extras.lat = lat;
    extras.lng = lng;
  }
  return extras;
}

/** Validation message for the digital address field, or null. Blank is fine. */
export function digitalAddressError(values: FormData, country: CountryCode): string | null {
  if (country !== "GH") return null;
  return ghanaPostGpsError(String(values.get("digitalAddress") ?? ""));
}
