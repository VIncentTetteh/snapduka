import {
  LANDMARK_MAX_LENGTH,
  ghanaPostGpsError,
  normalizeGhanaPostGps,
  roundCoordinate,
  type Database,
  type DeliveryAddress,
} from "@snapduka/core";
import { z } from "zod";

/**
 * Saved buyer addresses. The shape is Squad C's `DeliveryAddress`
 * (packages/core/src/addresses) plus a label, so an address saved here drops
 * into checkout, `buyer_snapshot.address` and `orders.delivery_address`
 * without translation. Limits match the checkout zod schema and the table's
 * CHECK constraints, so what passes here cannot be refused by the database.
 */
export type BuyerAddressRow = Database["public"]["Tables"]["buyer_addresses"]["Row"];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const buyerAddressInputSchema = z
  .object({
    label: optionalText(40),
    line1: z.string().trim().min(1, "Enter the street or house.").max(200),
    area: z.string().trim().max(100).default(""),
    city: z.string().trim().min(1, "Enter the town or city.").max(100),
    region: z.string().trim().max(100).default(""),
    country: z.enum(["GH", "NG", "CI"]).default("GH"),
    digitalAddress: z.string().trim().max(20).optional(),
    landmark: optionalText(LANDMARK_MAX_LENGTH),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({ code: "custom", message: "A location pin needs both latitude and longitude.", path: ["lat"] });
    }
    const gpsError = value.country === "GH" ? ghanaPostGpsError(value.digitalAddress) : null;
    if (gpsError) ctx.addIssue({ code: "custom", message: gpsError, path: ["digitalAddress"] });
    if (value.country !== "GH" && value.digitalAddress) {
      ctx.addIssue({ code: "custom", message: "Digital addresses are for Ghana only.", path: ["digitalAddress"] });
    }
  });

export type BuyerAddressInput = z.input<typeof buyerAddressInputSchema>;

/** Parsed input -> the columns a client may write (never buyer_profile_id from input). */
export function toAddressColumns(input: z.output<typeof buyerAddressInputSchema>) {
  const digitalAddress = input.country === "GH" ? normalizeGhanaPostGps(input.digitalAddress) : null;
  const hasPin = input.lat !== undefined && input.lng !== undefined;
  return {
    label: input.label,
    line1: input.line1,
    area: input.area,
    city: input.city,
    region: input.region,
    country: input.country,
    digital_address: digitalAddress,
    landmark: input.landmark,
    lat: hasPin ? roundCoordinate(input.lat as number) : null,
    lng: hasPin ? roundCoordinate(input.lng as number) : null,
    geo_source: hasPin ? "device" : digitalAddress ? "digital_address" : "none",
  } as const;
}

/** A saved address as the normalised delivery address checkout understands. */
export function toDeliveryAddress(row: BuyerAddressRow): DeliveryAddress {
  const geoSource = (["none", "device", "digital_address", "courier"] as const).find((s) => s === row.geo_source) ?? "none";
  return {
    line1: row.line1,
    area: row.area,
    city: row.city,
    region: row.region,
    country: row.country,
    digitalAddress: row.digital_address,
    lat: row.lat,
    lng: row.lng,
    landmark: row.landmark,
    geoSource,
  };
}

/** Fields read for listing and prefill — explicit, so nothing new leaks by default. */
export const ADDRESS_COLUMNS =
  "id,buyer_profile_id,label,line1,area,city,region,country,digital_address,lat,lng,landmark,geo_source,created_at,updated_at" as const;

export const MAX_SAVED_ADDRESSES = 20;
