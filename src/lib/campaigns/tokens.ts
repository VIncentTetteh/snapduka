import { randomBytes } from "node:crypto";

/**
 * Campaign link tokens.
 *
 * These end up on printed QR flyers and get read aloud over WhatsApp, so the
 * alphabet drops the glyphs people confuse: 0/O, 1/I/l, and u (which turns into
 * v in some hands). What is left is Crockford-ish base32, lowercase.
 */
const ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
const TOKEN_LENGTH = 8;

/**
 * The previous generator was `Math.random().toString(36).slice(2, 6)` — four
 * characters, ~1.7M keyspace, on a globally unique column with no retry. That
 * is guessable by enumeration, which matters once a token earns commission.
 */
export function generateCampaignToken(length: number = TOKEN_LENGTH): string {
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
 * Inserts with a fresh token, retrying only on a token collision.
 *
 * Both existing call sites swallowed insert errors entirely, so a collision
 * looked to the seller like a link that silently never appeared. `attempt`
 * receives the token so the caller decides the full row shape.
 */
export async function withUniqueToken<T>(
  attempt: (token: string) => Promise<{ data: T | null; error: { code?: string } | null }>,
  options: { retries?: number; length?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 5;
  for (let tries = 0; tries < retries; tries++) {
    const { data, error } = await attempt(generateCampaignToken(options.length));
    if (!error) return data as T;
    if (!isUniqueViolation(error)) throw new Error("Could not create the link. Please try again.");
  }
  throw new Error("Could not create a unique link. Please try again.");
}
