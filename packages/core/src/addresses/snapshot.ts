import type { CountryCode } from "../countries/types";
import type { Json } from "../supabase-types";
import { normalizeGhanaPostGps } from "./ghanapost";
import { LANDMARK_MAX_LENGTH, roundCoordinate, type DeliveryAddress } from "./types";

/**
 * Reads a normalised delivery address out of stored JSON — an order's
 * `delivery_address`, or the `address` inside `buyer_snapshot` for orders
 * placed before that column existed.
 *
 * Both are buyer-supplied JSON, so nothing is trusted: every field is
 * type-checked, strings are bounded, coordinates must come as a pair inside
 * the planet, and a digital address is re-normalised. The SQL trigger that
 * fills orders.delivery_address (202609250142) applies the same rules; this
 * is the read-side twin for rows it never touched. In core so the web order
 * screen and the Expo app read addresses identically.
 */
export function deliveryAddressFromJson(
  value: Json | undefined,
  country: CountryCode,
): DeliveryAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (key: string, max = 200): string => {
    const raw = value[key];
    return typeof raw === "string" ? raw.trim().slice(0, max) : "";
  };
  const coordinate = (key: string, limit: number): number | null => {
    const raw = value[key];
    return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= limit
      ? roundCoordinate(raw)
      : null;
  };

  let lat = coordinate("lat", 90);
  let lng = coordinate("lng", 180);
  if (lat === null || lng === null) {
    lat = null;
    lng = null;
  }
  const digitalAddress = country === "GH" ? normalizeGhanaPostGps(text("digitalAddress", 20)) : null;
  const landmark = text("landmark", LANDMARK_MAX_LENGTH) || null;
  const storedSource = text("geoSource", 32);

  const address: DeliveryAddress = {
    line1: text("line1"),
    area: text("area", 100),
    city: text("city", 100),
    region: text("region", 100),
    country,
    digitalAddress,
    landmark,
    lat,
    lng,
    geoSource:
      lat === null
        ? "none"
        : storedSource === "digital_address" || storedSource === "courier"
          ? storedSource
          : "device",
  };
  return address.line1 || address.city || address.digitalAddress || lat !== null ? address : null;
}

/** The delivery address of an order: the normalised column first, then the legacy snapshot. */
export function orderDeliveryAddress(
  order: { delivery_address?: Json | null; buyer_snapshot: Json },
  country: CountryCode,
): DeliveryAddress | null {
  const fromColumn = deliveryAddressFromJson(order.delivery_address ?? undefined, country);
  if (fromColumn) return fromColumn;
  const snapshot = order.buyer_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return deliveryAddressFromJson(snapshot.address, country);
}

/** One line for humans: "4 Palm St, Labone, Accra, Greater Accra". */
export function formatDeliveryAddressLine(address: DeliveryAddress): string {
  return [address.line1, address.area, address.city, address.region].filter(Boolean).join(", ");
}

/**
 * A Google Maps link for the buyer's pin, or null without one. Built from
 * numbers only, formatted here, so nothing buyer-typed reaches the URL.
 */
export function deliveryMapUrl(address: Pick<DeliveryAddress, "lat" | "lng">): string | null {
  if (typeof address.lat !== "number" || typeof address.lng !== "number") return null;
  if (!Number.isFinite(address.lat) || !Number.isFinite(address.lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${address.lat.toFixed(6)},${address.lng.toFixed(6)}`;
}
