import { describe, expect, it } from "vitest";

import { parseGuestOrder } from "./order";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    shopId: "11111111-1111-4111-8111-111111111111",
    fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "idem-key-12345",
    paymentMethod: "cash_on_delivery",
    buyer: {
      name: "Ama Serwaa",
      email: "ama@example.com",
      phone: "0241234567",
      country: "GH",
      address: { line1: "1 Main St", area: "Osu", city: "Accra", region: "Greater Accra" },
    },
    lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
    ...overrides,
  };
}

describe("parseGuestOrder", () => {
  it("accepts a Côte d'Ivoire buyer (previously rejected — CI was missing from the country enum)", () => {
    const result = parseGuestOrder(
      validInput({
        buyer: {
          name: "Kouassi Yao",
          email: "kouassi@example.com",
          phone: "0708091011",
          country: "CI",
          address: { line1: "1 Rue Principale", area: "Cocody", city: "Abidjan", region: "Abidjan" },
        },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buyer.phone).toBe("+2250708091011");
    }
  });

  it("normalizes and accepts a valid Ghana phone number", () => {
    const result = parseGuestOrder(validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buyer.phone).toBe("+233241234567");
    }
  });

  it("rejects a phone number with the wrong digit count for the buyer's country", () => {
    const result = parseGuestOrder(validInput({ buyer: { ...validInput().buyer, phone: "024123" } }));
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported country code", () => {
    const result = parseGuestOrder(validInput({ buyer: { ...validInput().buyer, country: "US" } }));
    expect(result.success).toBe(false);
  });
});
