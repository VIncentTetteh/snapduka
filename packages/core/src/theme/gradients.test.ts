import { describe, expect, it } from "vitest";

import {
  AVATAR_GRADIENT_STOPS,
  GRADIENT_SWATCHES,
  gradientForSeed,
  gradientStopsForSeed,
  initialsFor,
} from "./gradients";

/**
 * The implementation this was extracted from, copied verbatim from the web
 * client's gradient-placeholder.tsx. Moving the function into core must not
 * change a single assignment: a product that showed sage yesterday has to show
 * sage today, on both clients.
 */
const LEGACY_SWATCHES = [
  "linear-gradient(140deg,#E4D5BF,#A8875D)",
  "linear-gradient(140deg,#D8DDD2,#8B9683)",
  "linear-gradient(140deg,#E7D9D2,#B08D7D)",
  "linear-gradient(140deg,#DCD8E0,#8E879B)",
  "linear-gradient(140deg,#EADFCE,#C7AE8A)",
  "linear-gradient(140deg,#D5DDE0,#7F949B)",
] as const;

function legacyGradientForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % LEGACY_SWATCHES.length;
  return LEGACY_SWATCHES[index] ?? LEGACY_SWATCHES[0];
}

describe("gradientForSeed", () => {
  it("matches the original web implementation exactly", () => {
    // Realistic seeds: UUIDs, slugs, and the awkward ones.
    const seeds = [
      "c3c30000-0000-4000-8000-000000000001",
      "e3e30000-0000-4000-8000-0000000000c1",
      "sika-threads",
      "pureplatter-foods-ltd",
      "nipa-kloset",
      "",
      "a",
      "Ankara wrap dress — size 12",
      "🧵",
    ];
    for (const seed of seeds) {
      expect(gradientForSeed(seed)).toBe(legacyGradientForSeed(seed));
    }
  });

  it("agrees with the legacy implementation across many generated seeds", () => {
    for (let i = 0; i < 500; i += 1) {
      const seed = `product-${i}-${(i * 7919).toString(36)}`;
      expect(gradientForSeed(seed)).toBe(legacyGradientForSeed(seed));
    }
  });

  it("is deterministic — the same seed always gives the same swatch", () => {
    expect(gradientStopsForSeed("sika-threads")).toEqual(
      gradientStopsForSeed("sika-threads"),
    );
  });

  it("returns a real swatch for every seed, including empty", () => {
    for (const seed of ["", "x", "a-very-long-seed".repeat(20)]) {
      expect(GRADIENT_SWATCHES).toContainEqual(gradientStopsForSeed(seed));
    }
  });

  it("spreads seeds across every swatch rather than favouring one", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(gradientForSeed(`seed-${i}`));
    expect(seen.size).toBe(GRADIENT_SWATCHES.length);
  });

  it("exposes stops as hex pairs React Native can consume", () => {
    const [from, to] = gradientStopsForSeed("sika-threads");
    expect(from).toMatch(/^#[0-9A-F]{6}$/);
    expect(to).toMatch(/^#[0-9A-F]{6}$/);
    expect(AVATAR_GRADIENT_STOPS).toHaveLength(2);
  });
});

describe("initialsFor", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsFor("Sika Threads")).toBe("ST");
    expect(initialsFor("Pureplatter Foods Ltd")).toBe("PF");
  });

  it("handles a single word", () => {
    expect(initialsFor("Techieszon")).toBe("T");
  });

  it("collapses extra whitespace rather than emitting blanks", () => {
    expect(initialsFor("  Nipa   Kloset  ")).toBe("NK");
  });

  it("falls back to ? when there is nothing to take", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});
