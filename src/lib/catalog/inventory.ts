export type InventoryPolicy =
  | "track"
  | "continue_selling"
  | "deny_when_out_of_stock";

export type InventorySnapshot = {
  policy: InventoryPolicy;
  stock: number | null;
  reserved: number;
};

export type Availability = "available" | "preorder" | "sold_out";

export function availableQuantity(stock: number, reserved: number): number {
  return Math.max(0, stock - reserved);
}

export function canReserve(
  inventory: InventorySnapshot,
  requested: number,
): boolean {
  if (!Number.isInteger(requested) || requested <= 0) {
    return false;
  }

  if (inventory.policy !== "track") {
    return true;
  }

  return availableQuantity(inventory.stock ?? 0, inventory.reserved) >= requested;
}

export function deriveAvailability(
  inventory: InventorySnapshot,
): Availability {
  if (inventory.policy === "continue_selling") {
    return "preorder";
  }

  if (inventory.policy === "deny_when_out_of_stock") {
    return "available";
  }

  return availableQuantity(inventory.stock ?? 0, inventory.reserved) > 0
    ? "available"
    : "sold_out";
}
