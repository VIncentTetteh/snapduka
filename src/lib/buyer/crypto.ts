import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealing for saved buyer payment authorisations
 * (`buyer_payment_methods.provider_token_sealed`).
 *
 * Same construction and `v1.<iv>.<tag>.<data>` format as the social OAuth
 * tokens (src/lib/social/crypto.ts), so one decoder shape and one rotation
 * story covers both — but under its OWN key. A reusable charge authorisation
 * is a far more valuable secret than an Instagram token, and a leak of
 * SOCIAL_TOKEN_KEY must not also unlock every buyer's saved MoMo wallet.
 *
 * Fails closed: with no key configured, saving a payment method is simply not
 * offered (`isBuyerTokenSealingConfigured`), rather than storing anything weaker.
 */

const KEY_ENV = "BUYER_PAYMENT_TOKEN_KEY";

export function isBuyerTokenSealingConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]);
}

function key(): Buffer {
  const secret = process.env[KEY_ENV];
  if (!secret) {
    throw new Error(`Missing required environment variable: ${KEY_ENV}`);
  }
  return createHash("sha256").update(secret).digest();
}

export function sealBuyerToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function openBuyerToken(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Unrecognized sealed token format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
