import { describe, expect, it } from "vitest";

import {
  canTransitionFulfillment,
  FULFILLMENT_ONLY_STEPS,
  FULFILLMENT_STATES,
  isFulfillmentOnlyStep,
  type FulfillmentState,
} from "./fulfillment";

describe("canTransitionFulfillment", () => {
  it.each<[FulfillmentState, FulfillmentState]>([
    ["unconfirmed", "confirmed"],
    ["confirmed", "preparing"],
    ["confirmed", "dispatched"],
    ["preparing", "ready_for_pickup"],
    ["preparing", "dispatched"],
    ["ready_for_pickup", "fulfilled"],
    ["dispatched", "fulfilled"],
    ["dispatched", "returned"],
    ["fulfilled", "returned"],
  ])("allows %s -> %s", (from, to) => {
    expect(canTransitionFulfillment(from, to)).toBe(true);
  });

  it.each<[FulfillmentState, FulfillmentState]>([
    // Payment has not been confirmed; nothing may leave the shop yet.
    ["unconfirmed", "dispatched"],
    ["unconfirmed", "fulfilled"],
    // A parcel on the road comes back as a return, it is never "cancelled".
    ["dispatched", "cancelled"],
    // Going backwards would rewrite what the buyer was already told.
    ["dispatched", "preparing"],
    ["fulfilled", "dispatched"],
    // Terminal states.
    ["cancelled", "confirmed"],
    ["returned", "dispatched"],
    // Same-state writes are no-ops, not transitions.
    ["dispatched", "dispatched"],
  ])("rejects %s -> %s", (from, to) => {
    expect(canTransitionFulfillment(from, to)).toBe(false);
  });

  it("has an entry for every state, so no status can strand an order", () => {
    for (const state of FULFILLMENT_STATES) {
      expect(() => canTransitionFulfillment(state, "fulfilled")).not.toThrow();
    }
  });
});

describe("isFulfillmentOnlyStep", () => {
  it("covers the steps that have no order-status counterpart", () => {
    expect([...FULFILLMENT_ONLY_STEPS].sort()).toEqual(
      ["dispatched", "ready_for_pickup", "returned"].sort(),
    );
    expect(isFulfillmentOnlyStep("dispatched")).toBe(true);
    expect(isFulfillmentOnlyStep("fulfilled")).toBe(false);
    expect(isFulfillmentOnlyStep("nonsense")).toBe(false);
  });
});
