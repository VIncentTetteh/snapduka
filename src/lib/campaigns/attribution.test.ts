import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_TTL_DAYS,
  attributionCookieOptions,
  decodeAttribution,
  encodeAttribution,
  fallbackVisitorKey,
  visitorCookieOptions,
} from "./attribution";

const PAYLOAD = {
  token: "k7m2xp4q",
  clickId: "8f14e45f-ceea-467a-9c5a-1d2f3b4c5d6e",
  issuedAt: Math.floor(Date.UTC(2026, 6, 28, 12, 0, 0) / 1000),
};
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("attribution cookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a payload", () => {
    expect(decodeAttribution(encodeAttribution(PAYLOAD), NOW)).toEqual(PAYLOAD);
  });

  it("returns null for absent or malformed values rather than throwing", () => {
    expect(decodeAttribution(undefined, NOW)).toBeNull();
    expect(decodeAttribution("", NOW)).toBeNull();
    expect(decodeAttribution("no-dot-separator", NOW)).toBeNull();
    expect(decodeAttribution("only.", NOW)).toBeNull();
    expect(decodeAttribution("not-base64!.also-not", NOW)).toBeNull();
  });

  // The whole reason this cookie is signed: an unsigned one lets anyone claim
  // commission on a link they never posted.
  it("rejects a tampered payload", () => {
    const encoded = encodeAttribution(PAYLOAD);
    const [, signature] = encoded.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "someone-elses", c: PAYLOAD.clickId, s: PAYLOAD.issuedAt }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(decodeAttribution(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const [body] = encodeAttribution(PAYLOAD).split(".");

    expect(decodeAttribution(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, NOW)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    vi.stubEnv("ATTRIBUTION_SECRET", "secret-one");
    const encoded = encodeAttribution(PAYLOAD);
    vi.stubEnv("ATTRIBUTION_SECRET", "secret-two");

    expect(decodeAttribution(encoded, NOW)).toBeNull();
  });

  it("expires after the attribution window", () => {
    const encoded = encodeAttribution(PAYLOAD);

    expect(decodeAttribution(encoded, NOW + (ATTRIBUTION_TTL_DAYS - 1) * DAY)).toEqual(PAYLOAD);
    expect(decodeAttribution(encoded, NOW + (ATTRIBUTION_TTL_DAYS + 1) * DAY)).toBeNull();
  });

  it("rejects a cookie issued in the future", () => {
    const encoded = encodeAttribution({ ...PAYLOAD, issuedAt: PAYLOAD.issuedAt + 600 });

    expect(decodeAttribution(encoded, NOW)).toBeNull();
  });

  it("rejects a payload missing required fields", () => {
    const body = Buffer.from(JSON.stringify({ t: "abc" }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    // Signed correctly, but structurally invalid — must still be refused.
    expect(decodeAttribution(`${body}.${encodeAttribution(PAYLOAD).split(".")[1]}`, NOW)).toBeNull();
  });
});

describe("cookie options", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is named sd_attr and lasts the attribution window", () => {
    expect(ATTRIBUTION_COOKIE).toBe("sd_attr");
    expect(attributionCookieOptions().maxAge).toBe(ATTRIBUTION_TTL_DAYS * 24 * 60 * 60);
  });

  // Lax, not Strict: every creator journey arrives as a cross-site top-level
  // navigation from TikTok/Instagram/WhatsApp, which Strict would drop.
  it("uses SameSite=Lax and HttpOnly", () => {
    const options = attributionCookieOptions();

    expect(options.sameSite).toBe("lax");
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
  });

  it("only sets Secure in production, so local http dev still works", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(attributionCookieOptions().secure).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATTRIBUTION_SECRET", "prod-secret");
    expect(attributionCookieOptions().secure).toBe(true);
  });

  it("keeps the visitor cookie far longer than the attribution window", () => {
    expect(visitorCookieOptions().maxAge).toBeGreaterThan(attributionCookieOptions().maxAge);
  });
});

describe("fallbackVisitorKey", () => {
  it("is stable for the same visitor and link", () => {
    const input = { ip: "41.155.6.151", userAgent: "Chrome", campaignId: "abc" };

    expect(fallbackVisitorKey(input)).toBe(fallbackVisitorKey(input));
  });

  it("differs per link, so one visitor still counts once on each", () => {
    const base = { ip: "41.155.6.151", userAgent: "Chrome" };

    expect(fallbackVisitorKey({ ...base, campaignId: "a" })).not.toBe(
      fallbackVisitorKey({ ...base, campaignId: "b" }),
    );
  });

  it("does not leak the raw IP into the stored key", () => {
    const key = fallbackVisitorKey({ ip: "41.155.6.151", userAgent: "Chrome", campaignId: "abc" });

    expect(key).not.toContain("41.155");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});
