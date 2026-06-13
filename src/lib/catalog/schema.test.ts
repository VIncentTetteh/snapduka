import { describe, expect, it } from "vitest";

import { parseProductInput } from "@/lib/catalog/schema";

describe("parseProductInput", () => {
  it("parses integer minor-unit prices and trims product values", () => {
    const result = parseProductInput({
      name: "  Woven Bag  ",
      description: "  Handmade in Accra. ",
      price: "12500",
      currency: "GHS",
      inventoryPolicy: "track",
      stockQuantity: "4",
      sku: " BAG-1 ",
      status: "active",
    });

    expect(result).toEqual({
      success: true,
      data: {
        name: "Woven Bag",
        description: "Handmade in Accra.",
        priceMinor: 12500,
        currency: "GHS",
        inventoryPolicy: "track",
        stockQuantity: 4,
        sku: "BAG-1",
        status: "active",
      },
    });
  });

  it("rejects fractional money and invalid currency", () => {
    const result = parseProductInput({
      name: "Bag",
      price: "12.50",
      currency: "USD",
      inventoryPolicy: "track",
      stockQuantity: "1",
      status: "draft",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors.price).toBeDefined();
      expect(result.fieldErrors.currency).toBeDefined();
    }
  });

  it("allows preorder and always-available products without stock", () => {
    for (const inventoryPolicy of [
      "continue_selling",
      "deny_when_out_of_stock",
    ] as const) {
      const result = parseProductInput({
        name: "Made to order",
        price: "9000",
        currency: "NGN",
        inventoryPolicy,
        stockQuantity: "",
        status: "active",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stockQuantity).toBeNull();
      }
    }
  });
});
