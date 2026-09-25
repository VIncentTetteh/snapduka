import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmDelivery, protectionForRiderToken } from "@/lib/protect/service";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * The rider enters the buyer's delivery code at the door.
 *
 * Authorised by the rider token (printed on the shipment, not the buyer's
 * tracking token). Rate-limited per token and per IP on top of the database's
 * own five-strikes lockout, so a six-digit code cannot be brute-forced.
 */
const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

const OUTCOMES: Record<string, [number, string]> = {
  confirmed: [200, "Delivery confirmed. Thank you!"],
  already_confirmed: [200, "This delivery was already confirmed."],
  invalid_code: [400, "That code is not right. Ask the buyer to check their SMS or tracking page."],
  locked: [423, "Too many wrong codes. Try again in 30 minutes."],
  not_in_transit: [409, "This order is not out for delivery."],
  not_found: [404, "Delivery not found."],
};

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request, { params }: { params: Promise<{ riderToken: string }> }) {
  const { riderToken } = await params;
  if (!z.uuid().safeParse(riderToken).success) {
    return NextResponse.json({ error: "Delivery not found." }, { status: 404 });
  }
  const [perToken, perIp] = await Promise.all([
    checkRateLimit(`protect:rider:${riderToken}`, { limit: 10, windowMs: 30 * 60 * 1000 }),
    checkRateLimit(`protect:rider-ip:${clientIp(request)}`, { limit: 30, windowMs: 30 * 60 * 1000 }),
  ]);
  if (!perToken.ok || !perIp.ok) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid code." }, { status: 400 });
  }

  const found = await protectionForRiderToken(riderToken);
  if (!found) return NextResponse.json({ error: "Delivery not found." }, { status: 404 });

  try {
    const outcome = await confirmDelivery(found.view.orderId, "rider_code", parsed.data.code);
    const [status, message] = OUTCOMES[outcome] ?? [409, "Delivery could not be confirmed."];
    return NextResponse.json(status < 300 ? { outcome, message } : { error: message, outcome }, { status });
  } catch (error) {
    console.error("[protect/rider] failed", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
