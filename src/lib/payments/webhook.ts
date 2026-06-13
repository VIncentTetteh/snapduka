import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPaystackWebhook(body: Uint8Array, signature: string, secret: string) {
  const expected = createHmac("sha512", secret).update(body).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "hex"); } catch { return false; }
  return expected.length === received.length && timingSafeEqual(expected, received);
}
