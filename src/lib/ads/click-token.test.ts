import { describe, expect, it } from "vitest";

import { encodeAttribution } from "@/lib/campaigns/attribution";

import { CLICK_TOKEN_TTL_SECONDS, decodeClickToken, encodeClickToken } from "./click-token";

const NOW = 1_790_000_000_000;
const PAYLOAD = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  priceMinor: 201,
  placement: "discover",
  issuedAt: NOW / 1000,
};

describe("ad click tokens", () => {
  it("round-trips a signed token", () => {
    expect(decodeClickToken(encodeClickToken(PAYLOAD), NOW)).toEqual(PAYLOAD);
  });

  it("rejects a tampered price", () => {
    const [body, signature] = encodeClickToken(PAYLOAD).split(".");
    const forged = Buffer.from(
      JSON.stringify({ c: PAYLOAD.campaignId, p: PAYLOAD.productId, m: 1, l: "discover", s: PAYLOAD.issuedAt }),
    )
      .toString("base64url");
    expect(decodeClickToken(`${forged}.${signature}`, NOW)).toBeNull();
    expect(decodeClickToken(`${body}.x${signature.slice(1)}`, NOW)).toBeNull();
  });

  it("expires", () => {
    const token = encodeClickToken(PAYLOAD);
    expect(decodeClickToken(token, NOW + (CLICK_TOKEN_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(decodeClickToken(token, NOW + (CLICK_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it("an attribution cookie never verifies as a click token (separate key domain)", () => {
    const cookie = encodeAttribution({ token: "abc", clickId: "c1", issuedAt: NOW / 1000 });
    expect(decodeClickToken(cookie, NOW)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(decodeClickToken(null, NOW)).toBeNull();
    expect(decodeClickToken("nodot", NOW)).toBeNull();
    expect(decodeClickToken("a".repeat(2000), NOW)).toBeNull();
  });
});
