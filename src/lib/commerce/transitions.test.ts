import { describe, expect, it } from "vitest";

import { canTransitionOrder } from "@/lib/commerce/transitions";

describe("order transitions", () => {
  it("allows the normal fulfillment path", () => {
    expect(canTransitionOrder("pending", "confirmed")).toBe(true);
    expect(canTransitionOrder("confirmed", "processing")).toBe(true);
    expect(canTransitionOrder("processing", "completed")).toBe(true);
  });

  it("rejects reopening completed orders", () => {
    expect(canTransitionOrder("completed", "processing")).toBe(false);
  });
});
