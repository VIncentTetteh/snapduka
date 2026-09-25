import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isBuyerTokenSealingConfigured, openBuyerToken, sealBuyerToken } from "./crypto";

describe("buyer token sealing", () => {
  beforeEach(() => {
    vi.stubEnv("BUYER_PAYMENT_TOKEN_KEY", "test-buyer-key-please-rotate");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a token in the shared v1 format", () => {
    const sealed = sealBuyerToken("AUTH_abc123");

    expect(sealed).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(sealed).not.toContain("AUTH_abc123");
    expect(openBuyerToken(sealed)).toBe("AUTH_abc123");
  });

  it("uses a fresh IV every time", () => {
    expect(sealBuyerToken("same")).not.toBe(sealBuyerToken("same"));
  });

  it("does not open under a different key — in particular not the social key", () => {
    const sealed = sealBuyerToken("AUTH_abc123");
    vi.stubEnv("BUYER_PAYMENT_TOKEN_KEY", "some-other-key");

    expect(() => openBuyerToken(sealed)).toThrow();
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, data] = sealBuyerToken("AUTH_abc123").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;

    expect(() => openBuyerToken([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("reports not configured and refuses to seal without a key", () => {
    vi.stubEnv("BUYER_PAYMENT_TOKEN_KEY", "");

    expect(isBuyerTokenSealingConfigured()).toBe(false);
    expect(() => sealBuyerToken("x")).toThrow(/BUYER_PAYMENT_TOKEN_KEY/);
  });
});
