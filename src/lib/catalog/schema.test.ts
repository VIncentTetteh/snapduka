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

describe("parseProductInput price/stock bounds", () => {
  it("rejects a price string long enough to lose precision when converted to a number", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "9".repeat(20),
      currency: "GHS",
      inventoryPolicy: "continue_selling",
      status: "draft",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a normal price", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "15000",
      currency: "GHS",
      inventoryPolicy: "continue_selling",
      status: "draft",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a stock quantity string long enough to lose precision", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "15000",
      currency: "GHS",
      inventoryPolicy: "track",
      stockQuantity: "9".repeat(20),
      status: "draft",
    });
    expect(result.success).toBe(false);
  });
});
