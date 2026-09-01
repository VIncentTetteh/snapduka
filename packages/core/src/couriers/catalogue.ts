import type { CountryCode } from "../countries/types";

/**
 * The couriers a seller can pick from when recording a delivery.
 *
 * Lives in core because both the picker in the Expo app and the zod refinement
 * on POST /api/couriers/book validate against it. Two copies would mean a
 * courier the app offers and the server rejects.
 *
 * Hardcoded rather than configured, mirroring how video providers work in
 * src/lib/catalog/video.ts: the list changes with a release, not per tenant, so
 * a deploy already handles it. Putting it in country_configs would add a
 * migration and an admin screen for something nobody needs to edit at runtime.
 *
 * `other` is the escape hatch and is always offered. A seller in Tamale using a
 * courier nobody has heard of must never be blocked by a list we maintain.
 */
export type CourierKey =
  | "bolt"
  | "yango"
  | "uber"
  | "glovo"
  | "speedaf"
  | "dhl"
  | "jumia"
  | "gig"
  | "kwik"
  | "gokada"
  | "self"
  | "other"
  /** Pre-dates the picker. Every shipment booked before it had provider='manual'. */
  | "manual";

export type CourierOption = { key: CourierKey; label: string };

const LABELS: Record<CourierKey, string> = {
  bolt: "Bolt",
  yango: "Yango",
  uber: "Uber",
  glovo: "Glovo",
  speedaf: "Speedaf",
  dhl: "DHL",
  jumia: "Jumia Logistics",
  gig: "GIG Logistics",
  kwik: "Kwik",
  gokada: "Gokada",
  self: "Own rider",
  other: "Other",
  manual: "Seller-arranged delivery",
};

/**
 * Ordered by how often a seller in that market is likely to reach for them —
 * the common case should be the first tap, not a scroll.
 *
 * `self` and `other` are appended by courierOptions rather than repeated here.
 */
const BY_COUNTRY: Record<CountryCode, CourierKey[]> = {
  GH: ["bolt", "yango", "uber", "glovo", "speedaf", "dhl", "jumia"],
  NG: ["gig", "kwik", "gokada", "bolt", "uber", "dhl", "jumia"],
  CI: ["yango", "glovo", "dhl"],
};

export function isCourierKey(value: string): value is CourierKey {
  // Object.hasOwn, not `in`: `"constructor" in LABELS` is true via the
  // prototype chain, so `in` would accept it as a courier key and courierLabel
  // would then return Object's constructor function instead of a string.
  return Object.hasOwn(LABELS, value);
}

/**
 * What the buyer is told. Falls back to the catalogue label so a seller who
 * picks a known courier cannot mislabel it, and uses the seller's own text only
 * for 'other'.
 */
export function courierLabel(key: CourierKey, customName?: string | null): string {
  // A custom name is honoured only where the seller is describing their own
  // arrangement. It must never override a known brand, or a seller could label
  // a Bolt delivery as something else entirely on the buyer's receipt.
  if (key === "other" || key === "self") {
    const trimmed = customName?.trim();
    if (trimmed) return trimmed;
  }
  return Object.hasOwn(LABELS, key) ? LABELS[key] : LABELS.manual;
}

/**
 * The picker for a market: its couriers, then "Own rider", then "Other".
 * `manual` is never offered — it only exists to label rows booked before the
 * picker did.
 */
export function courierOptions(country: CountryCode): CourierOption[] {
  const keys = BY_COUNTRY[country] ?? BY_COUNTRY.GH;
  return [...keys, "self", "other"].map((key) => ({
    key: key as CourierKey,
    label: LABELS[key as CourierKey],
  }));
}

/**
 * Only 'other' forces the seller to type a name — "Own rider" already reads
 * clearly to a buyer, so naming the rider stays optional there.
 */
export function requiresCustomName(key: CourierKey): boolean {
  return key === "other";
}
