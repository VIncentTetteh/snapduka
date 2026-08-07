import { randomBytes } from "node:crypto";

import {
  generateCampaignToken as generate,
  withUniqueToken as withToken,
  type RandomBytes,
} from "@snapduka/core";

/**
 * Token generation lives in @snapduka/core so a link minted on the phone is
 * indistinguishable from one minted here — same alphabet, same length, same
 * unbiased sampling. Only the randomness source differs by runtime, so it is
 * injected; this module binds the Node one and keeps the web-side signatures.
 */
const nodeRandomBytes: RandomBytes = (count) => randomBytes(count);

export function generateCampaignToken(length?: number): string {
  return generate(nodeRandomBytes, length);
}

export async function withUniqueToken<T>(
  attempt: (token: string) => Promise<{ data: T | null; error: { code?: string } | null }>,
  options: { retries?: number; length?: number } = {},
): Promise<T> {
  return withToken(nodeRandomBytes, attempt, options);
}

export { isUniqueViolation } from "@snapduka/core";
