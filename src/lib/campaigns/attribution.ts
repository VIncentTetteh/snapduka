import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed attribution cookie.
 *
 * Once creator commission depends on which link a buyer followed, the campaign
 * token stops being analytics and becomes a claim on money. An unsigned cookie
 * (or the request body, which is what checkout trusted before) lets anyone mint
 * attribution to a link they never posted, so the payload is HMAC'd and the
 * signature is checked before the value is believed.
 */

export const ATTRIBUTION_COOKIE = "sd_attr";
export const VISITOR_COOKIE = "sd_vid";

/** Matches the informal window sellers already use ("if they buy this month"). */
export const ATTRIBUTION_TTL_DAYS = 30;
const ATTRIBUTION_TTL_SECONDS = ATTRIBUTION_TTL_DAYS * 24 * 60 * 60;
const VISITOR_TTL_SECONDS = 365 * 24 * 60 * 60;

export type AttributionPayload = {
  /** Campaign link token. */
  token: string;
  /** campaign_attributions row this click created, so the sale can point back. */
  clickId: string;
  /** Issued-at, unix seconds. */
  issuedAt: number;
};

function secret(): string {
  const value = process.env.ATTRIBUTION_SECRET;
  if (value) return value;
  // Local dev should not need another secret configured just to click a link.
  // Production must: an unsigned-equivalent fallback there would be the whole
  // forgery hole this module exists to close.
  if (process.env.NODE_ENV !== "production") return "development-attribution-secret";
  throw new Error("Missing required environment variable: ATTRIBUTION_SECRET");
}

function key(): Buffer {
  return createHash("sha256").update(secret()).digest();
}

function base64url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", key()).update(payload).digest());
}

export function encodeAttribution(payload: AttributionPayload): string {
  const body = base64url(
    Buffer.from(JSON.stringify({ t: payload.token, c: payload.clickId, s: payload.issuedAt })),
  );
  return `${body}.${sign(body)}`;
}

/**
 * Returns null for anything that is not a currently-valid, correctly-signed
 * cookie — tampered, truncated, expired, or simply absent. Callers treat null
 * as "no attribution", never as an error.
 */
export function decodeAttribution(
  cookieValue: string | undefined | null,
  now: number = Date.now(),
): AttributionPayload | null {
  if (!cookieValue) return null;
  const [body, signature] = cookieValue.split(".");
  if (!body || !signature) return null;

  const expected = fromBase64url(sign(body));
  const received = fromBase64url(signature);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and an attacker controls the length.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let parsed: { t?: unknown; c?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(fromBase64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.t !== "string" || typeof parsed.c !== "string" || typeof parsed.s !== "number") {
    return null;
  }
  if (!parsed.t || !parsed.c) return null;

  const ageSeconds = now / 1000 - parsed.s;
  if (ageSeconds < 0 || ageSeconds > ATTRIBUTION_TTL_SECONDS) return null;

  return { token: parsed.t, clickId: parsed.c, issuedAt: parsed.s };
}

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

/**
 * `sameSite: "lax"` is deliberate and load-bearing: every creator journey is a
 * top-level navigation in from TikTok, Instagram, Snapchat or WhatsApp, and
 * "strict" drops the cookie on exactly that hop.
 */
export function attributionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ATTRIBUTION_TTL_SECONDS,
  };
}

export function visitorCookieOptions(): CookieOptions {
  return { ...attributionCookieOptions(), maxAge: VISITOR_TTL_SECONDS };
}

/**
 * Dedupe key for a browser that blocks or has not yet been given the visitor
 * cookie. Hashed rather than stored raw so campaign_attributions never holds a
 * bare IP address.
 */
export function fallbackVisitorKey(input: { ip: string; userAgent: string; campaignId: string }): string {
  return createHmac("sha256", key())
    .update(`${input.ip}|${input.userAgent}|${input.campaignId}`)
    .digest("hex")
    .slice(0, 32);
}
