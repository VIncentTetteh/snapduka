import { createClient as createTokenClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { createClient as createCookieClient } from "./server";

/**
 * Request-scoped Supabase client for route handlers.
 *
 * The web app authenticates with cookies, which `./server` handles. The mobile
 * app has no cookies — it holds a Supabase session in SecureStore and sends the
 * access token as `Authorization: Bearer <jwt>`. Rather than duplicating every
 * seller endpoint, route handlers use this client and work for both.
 *
 * The distinction matters beyond convenience: a route that resolves the actor
 * from a Bearer token but then reads through the cookie client reads as
 * `anon`, so RLS returns nothing and the request fails in a way that looks like
 * missing data rather than missing auth.
 */

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * A JWS compact serialisation: three base64url segments separated by dots.
 *
 * This is load-bearing. Seller API keys are also sent as `Authorization:
 * Bearer …` (see lib/api-keys/auth.ts) but are shaped `sdk_live_<uuid>_<secret>`
 * — no dots. Treating one as the other would hand an API-key request an
 * unauthenticated client, or worse, send a raw API key to the auth server.
 */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Extract a Supabase access token from an Authorization header value. */
export function bearerJwtFrom(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const match = BEARER.exec(headerValue.trim());
  const token = match?.[1]?.trim();
  if (!token) return null;
  return JWT.test(token) ? token : null;
}

/** The Bearer access token on the current request, if it is a Supabase JWT. */
export async function requestBearerJwt(): Promise<string | null> {
  const store = await headers();
  return bearerJwtFrom(store.get("authorization"));
}

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!publishableKey) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return { url, publishableKey };
}

/**
 * A client scoped to whoever made this request — Bearer token if present,
 * cookies otherwise. Drop-in replacement for `createClient()` from `./server`
 * in any route handler that should also serve the mobile app.
 *
 * Either way the token travels to PostgREST, so RLS applies to the real user;
 * this grants no privilege the cookie path did not already have.
 */
export async function createRequestScopedClient() {
  const token = await requestBearerJwt();
  if (!token) return createCookieClient();

  const { url, publishableKey } = publicSupabaseConfig();
  return createTokenClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // There is no session to persist or refresh on the server: the token is
    // whatever this one request presented. The device owns refresh.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
