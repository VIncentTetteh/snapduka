import { describe, expect, it } from "vitest";

import {
  canonicalStorefrontUrl,
  shareStorefront,
  whatsappShareUrl,
} from "@/lib/storefront/sharing";

describe("storefront sharing", () => {
  it("builds stable canonical shop and product links", () => {
    expect(canonicalStorefrontUrl("https://snapduka.com/", "ama-shop")).toBe(
      "https://snapduka.com/ama-shop",
    );
    expect(
      canonicalStorefrontUrl(
        "https://snapduka.com",
        "ama-shop",
        "product-id",
      ),
    ).toBe("https://snapduka.com/ama-shop/products/product-id");
  });

  it("encodes WhatsApp share text and URL", () => {
    expect(
      whatsappShareUrl("Ama Shop", "https://snapduka.com/ama-shop"),
    ).toBe(
      "https://wa.me/?text=Shop%20Ama%20Shop%20on%20SnapDuka%3A%20https%3A%2F%2Fsnapduka.com%2Fama-shop",
    );
  });

  it("uses device sharing and falls back to WhatsApp", async () => {
    const share = async () => undefined;
    await expect(
      shareStorefront(
        { share },
        "Ama Shop",
        "https://snapduka.com/ama-shop",
      ),
    ).resolves.toBe("shared");

    await expect(
      shareStorefront({}, "Ama Shop", "https://snapduka.com/ama-shop"),
    ).resolves.toBe(
      "https://wa.me/?text=Shop%20Ama%20Shop%20on%20SnapDuka%3A%20https%3A%2F%2Fsnapduka.com%2Fama-shop",
    );
  });
});
