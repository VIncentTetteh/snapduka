export type SubscriptionState =
  | "trialing"
  | "active"
  | "past_due"
  | "grace"
  | "cancelled"
  | "expired";

const transitions: Record<SubscriptionState, SubscriptionState[]> = {
  trialing: ["active", "cancelled", "expired"],
  active: ["past_due", "cancelled"],
  past_due: ["grace", "active", "cancelled", "expired"],
  grace: ["active", "cancelled", "expired"],
  cancelled: ["expired"],
  expired: [],
};

export function canTransitionSubscription(
  from: SubscriptionState,
  to: SubscriptionState,
) {
  return transitions[from].includes(to);
}

export function effectiveSubscriptionState(
  subscription: {
    state: SubscriptionState;
    graceEndsAt: string | null;
  },
  now = new Date(),
): SubscriptionState {
  if (
    subscription.state === "past_due" &&
    subscription.graceEndsAt
  ) {
    return now < new Date(subscription.graceEndsAt) ? "grace" : "expired";
  }
  if (
    subscription.state === "grace" &&
    subscription.graceEndsAt &&
    now >= new Date(subscription.graceEndsAt)
  ) {
    return "expired";
  }
  return subscription.state;
}

export function mapPaystackSubscriptionEvent(event: unknown): SubscriptionState | null {
  if (event === "subscription.create" || event === "invoice.update") return "active";
  if (event === "invoice.payment_failed") return "past_due";
  if (event === "subscription.disable") return "cancelled";
  return null;
}
