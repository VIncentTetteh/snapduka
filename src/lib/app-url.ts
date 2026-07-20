import { headers } from "next/headers";

const FALLBACK = "http://localhost:3000";

/**
 * Origin used when generating user-facing links (share links, QR codes,
 * canonical URLs, auth confirmation links, Paystack payment callback URLs).
 *
 * In production the configured canonical URL is the only source — request
 * headers (Host / X-Forwarded-Host) are attacker-influenceable and must never
 * shape links that land in emails or payment callbacks. Outside production
 * the live request host wins — dev servers hop ports (3000 → 3001), and
 * links must point at wherever the app is actually being served from.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL || undefined;

  if (process.env.NODE_ENV === "production") {
    if (configured) return configured;
    // NEXT_PUBLIC_APP_URL should always be set explicitly, but a missing or
    // blank value must never silently resolve to localhost in production —
    // that's what broke every Paystack payment callback (buyers redirected
    // to an unreachable http://localhost:3000 after paying) and would break
    // auth-confirmation links the same way. Vercel auto-injects the stable
    // production domain at build and runtime with no manual config, so
    // prefer that over the dev-only localhost fallback while actually
    // running on Vercel.
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
    return FALLBACK;
  }

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (host) {
      const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
      return `${proto}://${host}`;
    }
  } catch {
    // No request scope (build-time render, tests) — fall through.
  }

  return configured ?? FALLBACK;
}

/** Host portion of {@link appOrigin}, for display (e.g. "snapduka.shop"). */
export async function appHost(): Promise<string> {
  try {
    return new URL(await appOrigin()).host;
  } catch {
    return new URL(FALLBACK).host;
  }
}
