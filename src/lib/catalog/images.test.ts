import { describe, expect, it } from "vitest";

import {
  imageObjectPath,
  resizeWithinBounds,
  validateProductImage,
} from "@/lib/catalog/images";

describe("catalog images", () => {
  it("scales images to a maximum edge of 1000 pixels", () => {
    expect(resizeWithinBounds(2400, 1200)).toEqual({
      width: 1000,
      height: 500,
    });
    expect(resizeWithinBounds(600, 800)).toEqual({
      width: 600,
      height: 800,
    });
  });

  it("builds seller-scoped WebP object paths", () => {
    expect(imageObjectPath("seller-1", "product-2", "image-3")).toBe(
      "seller-1/product-2/image-3.webp",
    );
  });

  it("rejects oversized and unsupported uploads", () => {
    expect(validateProductImage({ type: "image/png", size: 2_000_000 })).toEqual(
      { valid: true },
    );
    expect(validateProductImage({ type: "image/gif", size: 20 })).toEqual({
      valid: false,
      message: "Use a JPEG, PNG, or WebP image.",
    });
    expect(
      validateProductImage({ type: "image/jpeg", size: 11_000_000 }),
    ).toEqual({
      valid: false,
      message: "Images must be 10 MB or smaller.",
    });
  });
});
