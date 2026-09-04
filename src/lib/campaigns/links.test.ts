import { describe, expect, test } from "vitest";
import { shortLinkUrl } from "@snapduka/core";
import { normalizeCampaignToken } from "./links";

describe("campaign links", () => {
  test("normalizes shareable attribution tokens", () => {
    expect(normalizeCampaignToken(" TikTok Launch! ")).toBe("tiktok-launch");
  });

  test("coerces a name into the shape the token CHECK accepts", () => {
    // ^[a-z0-9][a-z0-9-]{3,63}$ — leading punctuation and trailing separators
    // both used to produce tokens the database silently rejected.
    expect(normalizeCampaignToken("!!! Launch !!!")).toBe("launch");
    expect(normalizeCampaignToken("🎉")).toBe("");
    expect(normalizeCampaignToken("a".repeat(200))).toHaveLength(64);
  });

  /**
   * The regression that matters. `campaignUrl` used to build
   * `?campaign=<token>` against the storefront, which bypasses /l/{token} —
   * the only route that records a click and sets the signed attribution
   * cookie. Links built that way produced no click rows at all and landed
   * every resulting order as source='fallback'. It has been deleted; this
   * pins the replacement so nobody reinvents it.
   */
  test("a tracked link goes through /l/, never ?campaign=", () => {
    const url = shortLinkUrl("https://snapduka.com", "tiktok-launch-a1b2c3");

    expect(url).toBe("https://snapduka.com/l/tiktok-launch-a1b2c3");
    expect(url).not.toContain("?campaign=");
  });

  test("does not double the slash when the origin carries one", () => {
    expect(shortLinkUrl("https://snapduka.com/", "abc123")).toBe("https://snapduka.com/l/abc123");
  });
});
