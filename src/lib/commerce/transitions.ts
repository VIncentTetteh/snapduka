export type OrderState = "draft" | "pending" | "confirmed" | "processing" | "completed" | "cancelled";

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
