// Ported from Snapduka/src/lib/commerce/transitions.ts — order state machine.
export type OrderState =
  | "draft"
  | "pending"
  | "confirmed"
  | "processing"
  | "completed"
  | "cancelled";

const allowed: Record<OrderState, OrderState[]> = {
  draft: ["pending", "cancelled"],
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderState, to: OrderState) {
  return allowed[from].includes(to);
}

/**
 * The statuses a seller may move an order to. `draft` and `pending` are set by
 * checkout, never by a seller, so they are not offered as actions and must be
 * rejected if one arrives from a client.
 */
export const SELLER_TRANSITIONS = [
  "confirmed",
  "processing",
  "completed",
  "cancelled",
] as const;

export type SellerTransition = (typeof SELLER_TRANSITIONS)[number];

export function isSellerTransition(value: string): value is SellerTransition {
  return (SELLER_TRANSITIONS as readonly string[]).includes(value);
}

/**
 * Fulfilment state implied by an order status change. Kept beside the state
 * machine so the two cannot drift: an order that is `completed` but still
 * `preparing` is a support ticket.
 */
export function fulfillmentForTransition(next: SellerTransition): string {
  switch (next) {
    case "confirmed":
      return "confirmed";
    case "processing":
      return "preparing";
    case "completed":
      return "fulfilled";
    case "cancelled":
      return "cancelled";
  }
}
