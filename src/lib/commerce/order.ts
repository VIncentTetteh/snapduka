import { z } from "zod";

import { normalizePhoneNumber } from "@/lib/auth/onboarding";
import { isValidPhoneForCountry, LANDMARK_MAX_LENGTH, normalizeGhanaPostGps } from "@snapduka/core";

const schema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  idempotencyKey: z.string().min(8).max(100),
  paymentMethod: z.enum(["paystack", "cash_on_delivery", "pay_on_pickup", "seller_arranged"]),
  buyer: z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.email().transform((value) => value.toLowerCase()),
      phone: z.string().trim().max(20),
      country: z.enum(["GH", "NG", "CI"]),
      address: z
        .object({
          line1: z.string().trim().max(200),
          area: z.string().trim().max(100),
          city: z.string().trim().max(100),
          region: z.string().trim().max(100),
          // Optional courier-grade detail. It rides inside buyer_snapshot.address
          // (the RPC stores p_buyer verbatim) and a trigger derives
          // orders.delivery_address from it (202609250142), so the order RPC —
          // totals, stock, payment — is untouched. A malformed GhanaPostGPS code
          // is dropped rather than refused: it is optional, and the typed
          // address is what the delivery relies on.
          digitalAddress: z
            .string()
            .trim()
            .max(20)
            .optional()
            .transform((value) => normalizeGhanaPostGps(value) ?? undefined),
          landmark: z.string().trim().max(LANDMARK_MAX_LENGTH).optional(),
          lat: z.number().min(-90).max(90).optional(),
          lng: z.number().min(-180).max(180).optional(),
        })
        .refine((address) => (address.lat === undefined) === (address.lng === undefined), {
          message: "A location pin needs both latitude and longitude.",
          path: ["lat"],
        }),
      marketingConsent: z.boolean().default(false),
    })
    .refine(
      (buyer) => isValidPhoneForCountry(normalizePhoneNumber(buyer.phone, buyer.country), buyer.country),
      { message: "Enter a valid phone number for the selected country.", path: ["phone"] },
    ),
  lines: z.array(z.object({
    productId: z.uuid(),
    variantId: z.uuid().nullable().optional(),
    quantity: z.number().int().positive().max(99),
  })).min(1).max(50),
});

export function parseGuestOrder(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false as const, fieldErrors: parsed.error.flatten() };
  return {
    success: true as const,
    data: {
      ...parsed.data,
      buyer: {
        ...parsed.data.buyer,
        phone: normalizePhoneNumber(parsed.data.buyer.phone, parsed.data.buyer.country),
      },
    },
  };
}
