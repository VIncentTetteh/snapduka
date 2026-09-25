import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs every webhook POST with HMAC-SHA256 of the raw body, keyed by the
 * app secret, in `X-Hub-Signature-256: sha256=<hex>`. Verified over the exact
 * bytes received — re-serialising parsed JSON changes whitespace and key order
 * and would reject every genuine delivery — and compared in constant time.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
