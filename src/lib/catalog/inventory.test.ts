import { describe, expect, it } from "vitest";

import {
  availableQuantity,
  canReserve,
  deriveAvailability,
} from "@/lib/catalog/inventory";

describe("catalog inventory", () => {
  it("subtracts active reservations from finite stock", () => {
    expect(availableQuantity(5, 2)).toBe(3);
    expect(canReserve({ policy: "track", stock: 5, reserved: 4 }, 1)).toBe(true);
    expect(canReserve({ policy: "track", stock: 5, reserved: 4 }, 2)).toBe(false);
  });

  it("keeps preorder and always-available products purchasable", () => {
    expect(
      deriveAvailability({
        policy: "continue_selling",
        stock: null,
        reserved: 0,
      }),
    ).toBe("preorder");
    expect(
      deriveAvailability({
        policy: "deny_when_out_of_stock",
        stock: null,
        reserved: 0,
      }),
    ).toBe("available");
  });

  it("marks tracked products sold out when reservations consume stock", () => {
    expect(
      deriveAvailability({ policy: "track", stock: 1, reserved: 1 }),
    ).toBe("sold_out");
  });
});
