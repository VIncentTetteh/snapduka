import { describe, expect, it } from "vitest";
import {
  CHANNEL_SUPPORTS_PREFILL,
  CHANNEL_TOKEN_SUFFIX,
  SHARE_CHANNELS,
  productPath,
  shareCaption,
  shortLinkUrl,
  storefrontPath,
} from "./channels";

describe("share channels", () => {
  it("gives every channel a distinct token suffix", () => {
    // The suffix is part of the link a buyer clicks. Two channels sharing one
    // would collide on the unique token column and merge their attribution.
    const suffixes = SHARE_CHANNELS.map((channel) => CHANNEL_TOKEN_SUFFIX[channel]);
    expect(new Set(suffixes).size).toBe(SHARE_CHANNELS.length);
  });

  it("matches the suffixes the web Share Studio already mints", () => {
    // Web has been creating links with these since before mobile existed;
    // changing one here would orphan every link already in circulation.
    expect(CHANNEL_TOKEN_SUFFIX).toEqual({ tiktok: "t", instagram: "i", snapchat: "s", whatsapp: "w" });
  });

  it("claims prefill only for the platform that actually supports it", () => {
    // Instagram, TikTok and Snapchat have no public prefill interface. Claiming
    // otherwise produces a button that opens an empty composer.
    expect(CHANNEL_SUPPORTS_PREFILL.whatsapp).toBe(true);
    expect(CHANNEL_SUPPORTS_PREFILL.instagram).toBe(false);
    expect(CHANNEL_SUPPORTS_PREFILL.tiktok).toBe(false);
    expect(CHANNEL_SUPPORTS_PREFILL.snapchat).toBe(false);
  });
});

describe("destinations", () => {
  it("builds the storefront and product paths the storefront routes serve", () => {
    expect(storefrontPath("ama-kitchen")).toBe("/ama-kitchen");
    expect(productPath("ama-kitchen", "p-1")).toBe("/ama-kitchen/products/p-1");
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(shortLinkUrl("https://snapduka.shop/", "abc-w")).toBe("https://snapduka.shop/l/abc-w");
    expect(shortLinkUrl("https://snapduka.shop", "abc-w")).toBe("https://snapduka.shop/l/abc-w");
  });
});

describe("shareCaption", () => {
  it("names the product and its price", () => {
    const caption = shareCaption({
      shopName: "Ama's Kitchen",
      product: { name: "Kente Scarf", priceMinor: 12050, currency: "GHS" },
    });

    expect(caption).toContain("Kente Scarf");
    expect(caption).toContain("120.50");
  });

  it("includes a video link when the product has one", () => {
    const caption = shareCaption({
      shopName: "Ama's Kitchen",
      product: {
        name: "Kente Scarf",
        priceMinor: 12050,
        currency: "GHS",
        videoUrl: "https://youtube.com/watch?v=x",
      },
    });

    expect(caption).toContain("https://youtube.com/watch?v=x");
  });

  it("omits the video line entirely when there is none", () => {
    const caption = shareCaption({
      shopName: "Ama's Kitchen",
      product: { name: "Kente Scarf", priceMinor: 12050, currency: "GHS", videoUrl: null },
    });

    expect(caption).not.toContain("Watch:");
  });

  it("falls back to the shop when no product is given", () => {
    const caption = shareCaption({ shopName: "Ama's Kitchen" });

    expect(caption).toContain("Ama's Kitchen");
    expect(caption).not.toContain("undefined");
  });
});
