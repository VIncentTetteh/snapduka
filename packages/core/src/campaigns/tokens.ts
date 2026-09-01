/**
 * Campaign link tokens.
 *
 * These end up on printed QR flyers and get read aloud over WhatsApp, so the
 * alphabet drops the glyphs people confuse: 0/O, 1/I/l, and u (which turns into
 * v in some hands). What is left is Crockford-ish base32, lowercase.
 *
 * The randomness source is injected rather than imported, because the two
 * callers have different ones — `node:crypto` on the server, `expo-crypto` on
 * the device — and neither is available in the other's runtime. The alphabet,
 * the length and the unbiased sampling live here so a token minted on a phone
 * is indistinguishable from one minted on the web.
 */

const ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

export const CAMPAIGN_TOKEN_LENGTH = 8;

/** Produces `count` cryptographically random bytes. */
export type RandomBytes = (count: number) => Uint8Array;

/**
 * Build a token from a random source.
 *
 * The mobile app previously used `Math.random().toString(36).slice(2, 6)` —
 * four characters, not cryptographic, on a globally unique column with no
 * retry. Guessable by enumeration, which matters once a token earns commission.
 */
export function generateCampaignToken(
  randomBytes: RandomBytes,
  length: number = CAMPAIGN_TOKEN_LENGTH,
): string {
  // Rejection sampling: `% ALPHABET.length` would bias toward the first
  // 256 % 30 = 16 characters.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let token = "";
  while (token.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      token += ALPHABET[byte % ALPHABET.length];
      if (token.length === length) break;
    }
  }
  return token;
}

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * Insert with a fresh token, retrying only on a token collision.
 *
 * Callers used to swallow insert errors entirely, so a collision looked to the
 * seller like a link that silently never appeared. `attempt` receives the token
 * so the caller decides the full row shape.
 */
export async function withUniqueToken<T>(
  randomBytes: RandomBytes,
  attempt: (token: string) => Promise<{ data: T | null; error: { code?: string } | null }>,
  options: { retries?: number; length?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 5;
  for (let tries = 0; tries < retries; tries++) {
    const { data, error } = await attempt(generateCampaignToken(randomBytes, options.length));
    if (!error) return data as T;
    if (!isUniqueViolation(error)) throw new Error("Could not create the link. Please try again.");
  }
  throw new Error("Could not create a unique link. Please try again.");
}

/** The channels a tracked link can be attributed to (campaign_links CHECK). */
export const CAMPAIGN_CHANNELS = [
  "whatsapp",
  "instagram",
  "tiktok",
  "snapchat",
  "other",
] as const;

export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
