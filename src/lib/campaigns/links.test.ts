import { describe, expect, test } from "vitest";
import { campaignUrl, normalizeCampaignToken } from "./links";
describe("campaign links", () => {
  test("normalizes shareable attribution tokens", () => {
    expect(normalizeCampaignToken(" TikTok Launch! ")).toBe("tiktok-launch");
    expect(campaignUrl("https://snapduka.com/ama", "TikTok Launch!")).toBe("https://snapduka.com/ama?campaign=tiktok-launch");
  });
});
