import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed promoted-listing click links.
 *
 * A sponsored slot is a claim on a seller's money: every click on it moves
 * prepaid budget to SnapDuka. So the link carries what was shown (campaign,
 * product, the auction price, when) under an HMAC, and the click route bills
 * only what verifies — nobody can mint a click on a campaign that was never
 * shown, or at a price they chose.
 *
 * Same construction and secret as campaign attribution
 * (src/lib/campaigns/attribution.ts: ATTRIBUTION_SECRET, SHA-256-derived key,
 * base64url body + HMAC), with a domain-separation prefix in the key
 * derivation so an attribution cookie can never verify as a click token or
 * the other way round.
 */

/** A link on a page left open this long stops billing; a fresh view re-signs. */
export const CLICK_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const KEY_DOMAIN = "snapduka:ads-click:v1:";

export type ClickTokenPayload = {
  campaignId: string;
  productId: string;
  /** Auction price per click at render time, minor units. */
  priceMinor: number;
  /** Where the slot was shown, e.g. "discover". */
  placement: string;
  /** Issued-at, unix seconds. */
  issuedAt: number;
};

function secret(): string {
  const value = process.env.ATTRIBUTION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV !== "production") return "development-attribution-secret";
  throw new Error("Missing required environment variable: ATTRIBUTION_SECRET");
}

function key(): Buffer {
  return createHash("sha256").update(KEY_DOMAIN + secret()).digest();
}

function base64url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(body: string): string {
  return base64url(createHmac("sha256", key()).update(body).digest());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEMENT = /^[a-z_]{1,30}$/;

export function encodeClickToken(payload: ClickTokenPayload): string {
  const body = base64url(
    Buffer.from(
      JSON.stringify({
        c: payload.campaignId,
        p: payload.productId,
        m: payload.priceMinor,
        l: payload.placement,
        s: payload.issuedAt,
      }),
    ),
  );
  return `${body}.${sign(body)}`;
}

/**
 * Null for anything that is not a currently-valid, correctly-signed token.
 * Callers treat null as "do not bill", never as an error: the visitor is still
 * sent to the product.
 */
export function decodeClickToken(token: string | null | undefined, now: number = Date.now()): ClickTokenPayload | null {
  if (!token || token.length > 1024) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = fromBase64url(sign(body));
  const received = fromBase64url(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let parsed: { c?: unknown; p?: unknown; m?: unknown; l?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(fromBase64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed.c !== "string" ||
    !UUID.test(parsed.c) ||
    typeof parsed.p !== "string" ||
    !UUID.test(parsed.p) ||
    typeof parsed.m !== "number" ||
    !Number.isSafeInteger(parsed.m) ||
    parsed.m <= 0 ||
    typeof parsed.l !== "string" ||
    !PLACEMENT.test(parsed.l) ||
    typeof parsed.s !== "number"
  ) {
    return null;
  }
  const ageSeconds = now / 1000 - parsed.s;
  if (ageSeconds < -60 || ageSeconds > CLICK_TOKEN_TTL_SECONDS) return null;

  return { campaignId: parsed.c, productId: parsed.p, priceMinor: parsed.m, placement: parsed.l, issuedAt: parsed.s };
}
