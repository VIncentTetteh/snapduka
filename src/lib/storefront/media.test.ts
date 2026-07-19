import { afterEach, describe, expect, it, vi } from "vitest";

import { mainImageUrl, normalizeToOne, publicMediaUrl } from "./media";

describe("publicMediaUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves storage paths against the public bucket endpoint", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(publicMediaUrl("seller/product/img.webp")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/product-images/seller/product/img.webp",
    );
    expect(publicMediaUrl("seller/logo.webp", "shop-logos")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/shop-logos/seller/logo.webp",
    );
  });

  it("passes through absolute URLs", () => {
    expect(publicMediaUrl("https://cdn.example.com/a.webp")).toBe(
      "https://cdn.example.com/a.webp",
    );
  });

  it("returns null for empty paths", () => {
    expect(publicMediaUrl(null)).toBeNull();
    expect(publicMediaUrl("")).toBeNull();
  });
});

describe("mainImageUrl", () => {
  it("picks the lowest-position image", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(
      mainImageUrl([
        { object_path: "s/p/second.webp", position: 1 },
        { object_path: "s/p/main.webp", position: 0 },
      ]),
    ).toContain("main.webp");
  });

  it("returns null when there is no media", () => {
    expect(mainImageUrl([])).toBeNull();
    expect(mainImageUrl(null)).toBeNull();
  });
});

describe("normalizeToOne", () => {
  it("returns the object unchanged when Supabase returns a singular embed (the real runtime shape for a to-one relationship)", () => {
    expect(normalizeToOne({ logo_path: "seller/logo.webp" })).toEqual({ logo_path: "seller/logo.webp" });
  });

  it("unwraps the first element when Supabase returns an array-shaped embed", () => {
    expect(normalizeToOne([{ logo_path: "seller/logo.webp" }])).toEqual({ logo_path: "seller/logo.webp" });
  });

  it("returns null for an empty array, null, or undefined", () => {
    expect(normalizeToOne([])).toBeNull();
    expect(normalizeToOne(null)).toBeNull();
    expect(normalizeToOne(undefined)).toBeNull();
  });
});
