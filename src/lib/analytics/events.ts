export const analyticsEventTypes = ["visit","product_view","checkout_start"] as const;
export type AnalyticsEventType = typeof analyticsEventTypes[number];
