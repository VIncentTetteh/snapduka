import { afterEach, describe, expect, it, vi } from "vitest";

import { openToken, sealToken } from "./crypto";

describe("social token sealing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a token", () => {
    vi.stubEnv("SOCIAL_TOKEN_KEY", "test-secret-key");
    const sealed = sealToken("act.1234567890");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("act.1234567890");
    expect(openToken(sealed)).toBe("act.1234567890");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    vi.stubEnv("SOCIAL_TOKEN_KEY", "test-secret-key");
    expect(sealToken("same")).not.toBe(sealToken("same"));
  });

  it("fails to open with the wrong key", () => {
    vi.stubEnv("SOCIAL_TOKEN_KEY", "key-one");
    const sealed = sealToken("secret");
    vi.stubEnv("SOCIAL_TOKEN_KEY", "key-two");
    expect(() => openToken(sealed)).toThrow();
  });

  it("throws clearly when the key is missing", () => {
    vi.stubEnv("SOCIAL_TOKEN_KEY", "");
    expect(() => sealToken("x")).toThrow(/SOCIAL_TOKEN_KEY/);
  });
});
