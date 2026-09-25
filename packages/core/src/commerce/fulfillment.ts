/**
 * Fulfilment state machine: where the parcel is, as opposed to `OrderState`,
 * which is where the sale is. The two move together for the steps a seller
 * drives from the order screen (see `fulfillmentForTransition`), but dispatch,
 * pickup-readiness and returns have no order-status counterpart and until now
 * were written straight to `orders.fulfillment_status` by whichever route got
 * there first, with no rule about what may follow what.
 *
 * That matters more than it looks: SnapDuka Protect issues the buyer's delivery
 * code on `dispatched` and releases funds on `fulfilled`, so an unguarded write
 * here is a write to money.
 */
export const FULFILLMENT_STATES = [
  "unconfirmed",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "dispatched",
  "fulfilled",
  "cancelled",
  "returned",
] as const;

export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

const allowed: Record<FulfillmentState, readonly FulfillmentState[]> = {
  unconfirmed: ["confirmed", "cancelled"],
  confirmed: ["preparing", "ready_for_pickup", "dispatched", "cancelled"],
  preparing: ["ready_for_pickup", "dispatched", "cancelled"],
  ready_for_pickup: ["fulfilled", "cancelled"],
  // Once it has left, it either arrives or comes back.
  dispatched: ["fulfilled", "returned"],
  fulfilled: ["returned"],
  cancelled: [],
  returned: [],
};

export function canTransitionFulfillment(from: FulfillmentState, to: FulfillmentState): boolean {
  return allowed[from].includes(to);
}

/**
 * Fulfilment steps with no order-status counterpart. These are advanced on
 * their own; every other fulfilment state is reached through an order
 * transition so the two can never disagree.
 */
export const FULFILLMENT_ONLY_STEPS = ["ready_for_pickup", "dispatched", "returned"] as const;

export type FulfillmentOnlyStep = (typeof FULFILLMENT_ONLY_STEPS)[number];

export function isFulfillmentOnlyStep(value: string): value is FulfillmentOnlyStep {
  return (FULFILLMENT_ONLY_STEPS as readonly string[]).includes(value);
}
