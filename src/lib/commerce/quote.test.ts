import { describe, expect, it } from "vitest";

import { calculateQuote } from "@/lib/commerce/quote";

describe("calculateQuote", () => {
  it("calculates integer totals from current server prices", () => {
    expect(
      calculateQuote(
        [{ productId: "p1", quantity: 2 }],
        [{ productId: "p1", priceMinor: 1250, available: true }],
        500,
      ),
    ).toEqual({ subtotalMinor: 2500, deliveryMinor: 500, totalMinor: 3000 });
  });

  it("rejects unavailable products and invalid quantities", () => {
    expect(() =>
      calculateQuote(
        [{ productId: "p1", quantity: 1 }],
        [{ productId: "p1", priceMinor: 100, available: false }],
        0,
      ),
    ).toThrow("Product is unavailable.");
    expect(() =>
      calculateQuote(
        [{ productId: "p1", quantity: 0 }],
        [{ productId: "p1", priceMinor: 100, available: true }],
        0,
      ),
    ).toThrow("Invalid quantity.");
  });
});
