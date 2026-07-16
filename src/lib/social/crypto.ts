import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealing for stored OAuth tokens. Key material comes from
 * SOCIAL_TOKEN_KEY (any strong secret; it is hashed to 32 bytes).
 */

function key(): Buffer {
  const secret = process.env.SOCIAL_TOKEN_KEY;
  if (!secret) {
    throw new Error("Missing required environment variable: SOCIAL_TOKEN_KEY");
  }
  return createHash("sha256").update(secret).digest();
}

export function sealToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function openToken(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Unrecognized sealed token format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
