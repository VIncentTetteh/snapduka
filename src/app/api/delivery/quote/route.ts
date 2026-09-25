import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeGhanaPostGps } from "@snapduka/core";

import { quoteDelivery } from "@/lib/couriers/aggregate";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Delivery options for a storefront checkout: the seller's own methods plus
 * live courier quotes (when any courier is switched on for the shop).
 *
 * Public and unauthenticated — the buyer has no account — so it is rate
 * limited per IP. Each call can fan out to paid partner APIs, which makes it
 * a cost-amplification target as much as an abuse one; the cache in
 * quoteDelivery absorbs repeats, the limit absorbs the rest.
 */

// 30 quotes per IP per 5 minutes: a buyer editing their address a few times
// fits comfortably; a scraper walking every city does not.
const QUOTE_LIMIT = { limit: 30, windowMs: 5 * 60 * 1000 };

const schema = z.object({
  shopId: z.uuid(),
  destination: z
    .object({
      line1: z.string().trim().max(200).optional(),
      area: z.string().trim().max(100).optional(),
      city: z.string().trim().min(1).max(100),
      region: z.string().trim().max(100).optional(),
      digitalAddress: z.string().trim().max(20).optional(),
      landmark: z.string().trim().max(160).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
      message: "A location pin needs both latitude and longitude.",
      path: ["lat"],
    }),
  parcelValueMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  weightGrams: z.number().int().min(0).max(100_000).optional(),
  codAmountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
});

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: Request) {
  const rl = await checkRateLimit(`delivery:quote:${clientIp(request)}`, QUOTE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many delivery quotes. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the delivery address." },
      { status: 400 },
    );
  }

  const { destination, ...rest } = parsed.data;
  const result = await quoteDelivery({
    ...rest,
    destination: {
      ...destination,
      // A malformed code is dropped, not rejected: the typed address is what
      // the delivery actually relies on, and a quote should not fail on an
      // optional field.
      digitalAddress: normalizeGhanaPostGps(destination.digitalAddress),
    },
  });
  if (!result.ok) return NextResponse.json({ error: "Shop not found." }, { status: 404 });

  return NextResponse.json({
    currency: result.currency,
    options: result.options,
  });
}
