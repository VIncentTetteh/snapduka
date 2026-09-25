import { z } from "zod";

import type { CountryCode } from "../countries/types";

/**
 * Where a delivery address's coordinates came from, so nobody downstream
 * mistakes a guess for a fix. A courier quoting off a `device` pin is quoting
 * off where the buyer's phone was when they pressed the button, which is
 * usually but not always the door.
 */
export const GEO_SOURCES = ["none", "device", "digital_address", "courier"] as const;
export type GeoSource = (typeof GEO_SOURCES)[number];

/**
 * The normalised delivery address stored on `orders.delivery_address`.
 *
 * `buyer_snapshot.address` stays exactly as it was (line1/area/city/region):
 * receipts, notifications and the mobile app all read it, and changing its
 * shape would be a change to every one of them. This is the structured copy
 * couriers and the trust tooling read.
 *
 * Everything past `country` is optional because the vast majority of buyers
 * will never type a GhanaPostGPS code, and a checkout that demands one loses
 * the sale.
 */
export type DeliveryAddress = {
  line1: string;
  area: string;
  city: string;
  region: string;
  country: CountryCode;
  /** Normalised GhanaPostGPS code, e.g. `GA-123-4567`. Ghana only. */
  digitalAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** "Opposite the Total filling station" — what riders actually navigate by. */
  landmark?: string | null;
  geoSource: GeoSource;
};

export const LANDMARK_MAX_LENGTH = 160;

/**
 * The optional fields a checkout may send alongside the classic four.
 *
 * Coordinates are bounded to the planet and rounded server-side; a pin needs
 * both halves or neither, since a latitude alone locates nothing and would
 * only mislead a rider.
 */
export const deliveryAddressExtrasSchema = z
  .object({
    digitalAddress: z.string().trim().max(20).optional(),
    landmark: z.string().trim().max(LANDMARK_MAX_LENGTH).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: "A location pin needs both latitude and longitude.",
    path: ["lat"],
  });

export type DeliveryAddressExtras = z.infer<typeof deliveryAddressExtrasSchema>;

/**
 * Six decimal places is ~11 cm. Anything finer is noise from the GPS chip, and
 * storing it implies a precision the reading never had.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
