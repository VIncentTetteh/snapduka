import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyMetaSignature } from "./signature";

const SECRET = "app-secret";
const BODY = '{"object":"whatsapp_business_account","entry":[]}';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("accepts Meta's signature over the raw body", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  // Re-serialised JSON differs byte-for-byte from what Meta signed.
  it("rejects a body that differs by a single byte", () => {
    expect(verifyMetaSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false);
  });

  it.each([
    ["missing", null],
    ["no prefix", createHmac("sha256", SECRET).update(BODY).digest("hex")],
    ["wrong secret", sign(BODY, "other")],
    ["truncated", sign(BODY).slice(0, 20)],
    ["not hex", "sha256=zzzz"],
  ])("rejects a %s signature", (_label, header) => {
    expect(verifyMetaSignature(BODY, header, SECRET)).toBe(false);
  });
});
