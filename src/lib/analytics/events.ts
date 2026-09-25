/**
 * analytics_events types, in two lists that must stay apart.
 *
 * `analyticsEventTypes` is what the public, unauthenticated ingestion route
 * (/api/analytics/events) accepts from a storefront browser. Anything in it
 * can be forged by anyone, so it holds only events whose worst case is noise.
 *
 * `serverAnalyticsEventTypes` are facts only the server knows — an order was
 * placed, Protect was chosen, a delivery was confirmed. They are written by
 * triggers and outbox handlers through record_server_analytics_event
 * (migration 202609250241), never by the browser: a browser that could post
 * `checkout_completed` could set any shop's conversion rate.
 */
export const analyticsEventTypes = ["visit", "product_view", "checkout_start"] as const;
export type AnalyticsEventType = (typeof analyticsEventTypes)[number];

export const serverAnalyticsEventTypes = [
  "checkout_completed",
  "protect_opted_in",
  "delivery_confirmed",
  // Allowed by the schema; not recorded yet. Accepting a Snap-to-list draft
  // happens on the device with no server call to hook.
  "listing_ai_accepted",
  "wa_conversation_started",
  "payout_instant_requested",
] as const;
export type ServerAnalyticsEventType = (typeof serverAnalyticsEventTypes)[number];

/** Every type the analytics_event_type_check constraint allows. */
export const allAnalyticsEventTypes = [...analyticsEventTypes, ...serverAnalyticsEventTypes] as const;
export type AnyAnalyticsEventType = (typeof allAnalyticsEventTypes)[number];
