import { z } from "zod";

import { normalizePhoneNumber } from "@/lib/auth/onboarding";

const schema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  idempotencyKey: z.string().min(8).max(100),
  paymentMethod: z.enum(["paystack", "cash_on_delivery", "pay_on_pickup", "seller_arranged"]),
  buyer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email().transform((value) => value.toLowerCase()),
    phone: z.string(),
    country: z.enum(["GH", "NG"]),
    address: z.object({
      line1: z.string().trim().max(200),
      area: z.string().trim().max(100),
      city: z.string().trim().max(100),
      region: z.string().trim().max(100),
    }),
    marketingConsent: z.boolean().default(false),
  }),
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
