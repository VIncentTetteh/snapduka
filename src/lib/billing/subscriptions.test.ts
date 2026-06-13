import { describe, expect, test } from "vitest";

import {
  canTransitionSubscription,
  effectiveSubscriptionState,
  mapPaystackSubscriptionEvent,
} from "./subscriptions";

describe("subscription state", () => {
  test("allows recovery and cancellation but rejects impossible transitions", () => {
    expect(canTransitionSubscription("past_due", "grace")).toBe(true);
    expect(canTransitionSubscription("grace", "active")).toBe(true);
    expect(canTransitionSubscription("expired", "active")).toBe(false);
  });

  test("keeps failed billing in grace until the configured deadline", () => {
    expect(
      effectiveSubscriptionState(
        { state: "past_due", graceEndsAt: "2026-06-20T00:00:00.000Z" },
        new Date("2026-06-15T00:00:00.000Z"),
      ),
    ).toBe("grace");
    expect(
      effectiveSubscriptionState(
        { state: "past_due", graceEndsAt: "2026-06-20T00:00:00.000Z" },
        new Date("2026-06-21T00:00:00.000Z"),
      ),
    ).toBe("expired");
  });

  test("maps Paystack events without allowing stale events to regress billing", () => {
    expect(mapPaystackSubscriptionEvent("subscription.create")).toBe("active");
    expect(mapPaystackSubscriptionEvent("invoice.payment_failed")).toBe("past_due");
    expect(mapPaystackSubscriptionEvent("subscription.disable")).toBe("cancelled");
    expect(mapPaystackSubscriptionEvent("charge.success")).toBeNull();
  });
});
