import { describe, expect, it } from "vitest";

import { allAnalyticsEventTypes, analyticsEventTypes, serverAnalyticsEventTypes } from "./events";

describe("analytics event types", () => {
  it("never lets the public ingestion route accept a server-only fact", () => {
    for (const type of serverAnalyticsEventTypes) {
      expect(analyticsEventTypes as readonly string[]).not.toContain(type);
    }
    expect(analyticsEventTypes).toEqual(["visit", "product_view", "checkout_start"]);
  });

  it("matches the analytics_event_type_check constraint (migration 202609250241)", () => {
    expect([...allAnalyticsEventTypes].sort()).toEqual(
      [
        "checkout_completed",
        "checkout_start",
        "delivery_confirmed",
        "listing_ai_accepted",
        "payout_instant_requested",
        "product_view",
        "protect_opted_in",
        "visit",
        "wa_conversation_started",
      ].sort(),
    );
  });
});
