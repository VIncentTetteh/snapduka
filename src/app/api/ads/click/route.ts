import { NextResponse, type NextRequest } from "next/server";

import { handleAdClick } from "@/lib/ads/clicks";
import { appOrigin } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * Sponsored-slot click redirect: /api/ads/click?t=<signed token> -> product
 * page. The visitor always gets the redirect; whether the advertiser is billed
 * is decided in handleAdClick and never delays or breaks the navigation.
 *
 * The destination is built from our own product and shop rows, never from the
 * request, so this cannot be used as an open redirect.
 */
export async function GET(request: NextRequest) {
  const origin = (await appOrigin().catch(() => null)) ?? request.nextUrl.origin;
  const result = await handleAdClick({
    token: request.nextUrl.searchParams.get("t"),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? request.headers.get("x-real-ip") ?? "unknown",
    userAgent: request.headers.get("user-agent"),
    purpose: request.headers.get("purpose"),
    secPurpose: request.headers.get("sec-purpose"),
    secFetchMode: request.headers.get("sec-fetch-mode"),
  }).catch((error: unknown) => {
    console.error("[ads/click] failed", error instanceof Error ? error.message : error);
    return { destination: "/discover", outcome: "error" as const };
  });

  const destination = new URL(result.destination, origin);
  if (destination.origin !== new URL(origin).origin) return NextResponse.redirect(new URL("/discover", origin));
  destination.searchParams.set("campaign", "sponsored");
  const response = NextResponse.redirect(destination, 302);
  // Never cached: a cached redirect would skip billing and dedupe alike.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
